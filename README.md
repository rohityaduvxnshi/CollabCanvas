# CollabCanvas

A **real-time collaborative kanban board** — a live, multiplayer Trello. Multiple
authenticated users edit the same board simultaneously; edits sync in real time,
conflicts resolve automatically via CRDTs (Yjs), users see each other's live
cursors and "who's editing what," offline edits merge on reconnect, and boards
persist to Postgres. Access is role-based (editor vs viewer) behind OAuth login.

> This README grows with the build. See the build phases below for current status.
> A full portfolio write-up (architecture, trade-offs, honest limitations, metrics)
> lands in Phase 8.

## Architecture (three deployable pieces)

```
Next.js app (Vercel)  ──JWT(room+role, 5min)──▶  WS server (Fly.io)
  - UI (client comps)                              - y-websocket sync + awareness
  - Auth.js (GitHub/Google)                        - verifies JWT, enforces read-only
  - API routes                                     - loads/saves Postgres snapshots
        │                                                    │
        └──────────────  Postgres (Neon)  ───────────────────┘
                  users, boards, members, snapshots
```

## Repo layout (npm workspaces)

```
collabcanvas/
├─ web/               # Next.js 16 App Router (TypeScript) — deploys to Vercel
├─ ws-server/         # Standalone Node + TS WebSocket server — deploys to Fly.io
├─ packages/shared/   # Shared TS types (BoardData, presence, JWT claims)
├─ docs/              # claude-design-brief.md — frontend regeneration handoff
└─ scripts/           # headless verification harnesses (convergence, reconnect)
```

The visual layer is intentionally swappable: all sync/CRDT/presence logic lives
in framework-agnostic hooks (`web/lib/board`, `web/lib/yjs`) and the presentational
components contain zero Yjs. The UI contract and rebuild instructions live in
[`docs/claude-design-brief.md`](docs/claude-design-brief.md). The current visuals
were designed in Claude Design and ported against that contract — warm-cream
neo-brutalist theme, light/dark, Fredoka + Space Grotesk type.

## Local development

```bash
npm install            # from repo root — links all workspaces

npm run dev            # start the web app (http://localhost:3000)
npm run dev:ws         # start the WS server (http://localhost:4000, /health)
npm run dev:all        # both at once

npm run typecheck      # strict TS across all workspaces
```

Copy `web/.env.example` → `web/.env.local` and `ws-server/.env.example` → `ws-server/.env`
and fill values as each phase requires (see the phase notes).

### Local database

`npm run db:start --workspace=packages/db` runs a local Prisma Postgres (no
Docker needed); `npx prisma db push` from `packages/db` syncs the schema.
Production uses Neon via the same `DATABASE_URL`.

### OAuth sign-in (you provision this once)

Create two OAuth apps and put the credentials in `web/.env.local`:

1. **GitHub** → Settings → Developer settings → OAuth Apps → New:
   homepage `http://localhost:3000`, callback
   `http://localhost:3000/api/auth/callback/github` →
   `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.
2. **Google** → Cloud Console → Credentials → OAuth client (Web application):
   redirect URI `http://localhost:3000/api/auth/callback/google` →
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

(For the deployed app, add the same callbacks on the production domain.)
`AUTH_SECRET` and `WS_JWT_SECRET` are already generated in the local env files;
`WS_JWT_SECRET` must be identical for web and ws-server.

## Build status

- [x] **Phase 0** — Scaffold: monorepo, strict TS, `.env.example`, `/health`.
- [x] **Phase 1** — Core CRDT sync: Yjs doc model, `deriveBoardView`, `useBoard`,
  dnd-kit board, hand-rolled y-websocket-v3 server handler. Real-time sync,
  concurrent-move convergence, and auto-reconnect verified with headless
  harnesses in [`scripts/`](scripts/). (y-websocket v3 dropped its bundled server
  helper, so the WS server re-implements the reference sync/awareness handler
  over `ws` + `y-protocols`.)
- [x] **Phase 2** — Presence / awareness: live cursors (board-content
  coordinates, so they're correct under any scroll offset), per-card "editing"
  badges, presence avatar bar, per-tab guest identities. Cursor writes are
  throttled to ~20/s sustained (time-based, leading + trailing edge). Verified
  headlessly in [`scripts/phase2-presence.ts`](scripts/phase2-presence.ts):
  propagation, throttle rate, trailing-edge delivery, and disconnect cleanup.
- [x] **Phase 3** — Postgres snapshot persistence: snapshots load on first join,
  save debounced (3s idle) + flush/evict on last disconnect. Local dev DB is
  `prisma dev` (Prisma Postgres, no Docker) via the shared
  [`packages/db`](packages/db) package (Prisma 7: TS client generator + pg
  driver adapter — differs from the spec's classic `prisma-client-js` sketch).
  Verified: server killed + restarted → state restored from Postgres; 11 rapid
  edits produced 2 snapshot writes (debounce + disconnect flush), not 11.
- [x] **Phase 4** — Auth + roles: Auth.js v5 (GitHub + Google) with Prisma
  adapter + database sessions; boards dashboard (create → owner auto-editor);
  share-by-email with editor/viewer roles; membership-gated board pages; the
  cross-service token flow (`GET /api/rooms/:boardId/ws-token` → 5-min HS256
  JWT → verified by the WS server on upgrade, room must match claim, token
  auto-refreshed on reconnect). **Server-side viewer write-enforcement is
  implemented** (not client-only): the WS server drops document-mutating sync
  messages from viewer connections, so a tampered client still can't write —
  verified headlessly in [`scripts/phase4-auth.ts`](scripts/phase4-auth.ts)
  (12/12: token rejects, editor sync, viewer write-drop, presence-for-viewers).
  OAuth app credentials are the one thing you must provision (see below).
- [x] **Phase 5** — Offline sync + reconnection UX + light history. The board
  is offline-first: the doc + `y-indexeddb` cache + stores come up with zero
  network (a reload on a plane still shows your board); the WebSocket side
  attaches when the short-lived token arrives and retries quietly while
  offline. Status distinguishes offline / reconnecting / live (pill + banner).
  Named snapshot history: save (server copies its latest snapshot — may lag
  live edits by the ~3s debounce), list, and restore (a hard reset rebuilt in
  one transaction — all clients converge; confirm dialog warns). Verified in
  [`scripts/phase5-offline.ts`](scripts/phase5-offline.ts): IndexedDB
  persistence across "reloads" (fake-indexeddb), offline-edit replay to the
  server, restore convergence across clients.
- [x] **Phase 6** — Hardening. Rate limits on the API surface (ws-token,
  history save, share, create — in-process limiter, right-sized for the
  single-node deployment), runtime validation on everything that crosses the
  wire, entity caps (50 columns / 500 cards / clamped text lengths — enforced
  client-side; the WS server does **not** decode CRDT updates to re-validate,
  an honest v1 limitation), a 1MB WebSocket message cap, structured JSON-line
  logging, and graceful shutdown that flushes every live room's snapshot
  (SIGINT/SIGTERM/SIGBREAK + a test-only HTTP trigger, since Windows services
  don't reliably deliver POSIX signals). Token-expiry semantics: checked at
  the WS handshake; live connections outlive their token, and clients recover
  from expired-token reconnects by refreshing `provider.params`. Verified by
  14 unit tests ([`scripts/unit`](scripts/unit)) + a 10-check harness
  ([`scripts/phase6-hardening.ts`](scripts/phase6-hardening.ts)) that spawns
  its own server and proves expiry recovery, oversized-payload rejection, and
  the shutdown flush end-to-end. An adversarial review pass then caught (and we
  fixed) two high-severity server bugs: a startup race where a client dying
  mid-handshake could flush an empty doc over the real snapshot (writes are now
  gated on the initial load), and a missing socket error handler that let a
  single TCP reset crash the whole process.
- [ ] Phase 7 — Deploy (self-hosted: Windows VPS + Caddy — see
  [`deploy/README.md`](deploy/README.md); kit is ready, awaiting go).
- [ ] Phase 8 — README + portfolio write-up.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Yjs · y-websocket ·
y-indexeddb · y-protocols (Awareness) · Postgres (Neon) · Prisma · Auth.js
(NextAuth) · @dnd-kit · Vercel · Fly.io.
