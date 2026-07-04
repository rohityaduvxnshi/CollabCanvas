# CollabCanvas

**Live: [collabcanvas.dash-board.in](https://collabcanvas.dash-board.in)**
*(the live deployment currently runs the pre-email-auth build; email sign-in
lands with the next deploy)*

A **real-time collaborative kanban board** — a live, multiplayer Trello.
Multiple users edit the same board simultaneously; edits sync in real time and
conflicts resolve automatically via CRDTs (Yjs). You see everyone's live
cursors and who's editing which card, offline edits merge cleanly on
reconnect, and boards persist to Postgres with named, restorable history.
Access is role-based (editor vs viewer), enforced **server-side**.

Built spec-first in reviewed phases: every phase shipped with a headless
verification harness, then went through an adversarial multi-agent code review
before being called done. The reviews found real bugs — including a
high-severity server race that could wipe a board's snapshot, a shutdown-flush
race that clobbered good snapshots, and a crash-DoS via mid-handshake TCP
resets — and every confirmed finding was fixed and re-verified. The full log
lives in [`CLAUDE.md`](CLAUDE.md).

## Why this project is interesting (the 60-second tour)

- **Convergence is tested, not assumed.** Headless harnesses drive two real
  Yjs clients through concurrent moves, dropped connections, and server
  restarts, then assert byte-identical board views. The decisive drag-and-drop
  semantics test: `[A, B]` — drag A onto B — must yield `[B, A]` on *both*
  clients.
- **Offline-first for real.** The board renders from IndexedDB with zero
  network (a reload on a plane still shows your board); the WebSocket attaches
  later, retries quietly, and offline edits replay and merge on reconnect —
  including through a server-side history restore (a regression test covers
  exactly that collision).
- **The server doesn't trust clients.** Viewer connections can *say* anything;
  the WS server drops document-mutating sync messages from them, so a tampered
  client still can't write. JWTs are verified at upgrade, before the handshake
  completes.
- **Hand-rolled y-websocket v3 server.** y-websocket v3 ships no server helper
  anymore, so `ws-server/` re-implements the reference sync/awareness protocol
  handler over `ws` + `y-protocols`, plus what the reference never had:
  snapshot persistence with debounced writes, graceful shutdown that flushes
  every live room, structured logs, message caps, and crash-safety under
  mid-handshake disconnects.
- **Email auth with a hardened verification flow.** Sign-up mails a 6-digit
  code (stored sha256-hashed, one-shot, 15-min TTL); verification requires the
  code **and** the password, which closes the classic pre-verification
  account-takeover window. Brute-force guards live inside `authorize()` itself
  because the credentials callback is directly POSTable.

## Architecture

Self-hosted on a Windows VPS behind [Caddy](https://caddyserver.com/) (shared
reverse proxy, automatic Let's Encrypt), services run via
[WinSW](https://github.com/winsw/winsw):

```
            Caddy (:443, both hostnames)
              │                    │
   collabcanvas.dash-board.in   collabcanvas-ws.dash-board.in
              │                    │
   Next.js 16 app (:3000) ──JWT(room+role, 5 min)──▶ WS server (:4000)
     - App Router UI / RSC                             - y-websocket v3 sync + awareness
     - Auth.js v5 (email+pw, OAuth-ready)              - verifies JWT at upgrade
     - API routes (ws-token, history)                  - drops viewer writes server-side
              │                                        - loads/saves board snapshots
              └────────────  Postgres 17  ─────────────┘
                users, boards, members, snapshots, history
```

### Doc model (the CRDT part)

One Y.Doc per board; [`web/lib/yjs/schema.ts`](web/lib/yjs/schema.ts) is the
only module that knows field names:

- `meta` Y.Map `{title, updatedAt}` · `columnOrder` Y.Array&lt;colId&gt; ·
  `columns` Y.Map&lt;colId → Y.Map{id, title, cardOrder}&gt; ·
  `cards` Y.Map&lt;cardId → Y.Map{id, title, description, createdBy}&gt;
- **Order lives in arrays, entities in flat maps**, and every multi-step
  mutation happens in one `doc.transact` so remote peers never observe a
  half-applied move.
- `deriveBoardView` is the single render source: it deterministically dedupes
  duplicate ids and drops orphans/missing refs, so all clients render the same
  view even from a messy merge.
- Two non-obvious choices that came out of review:
  - `deleteColumn` does **not** delete card entities — a concurrent `moveCard`
    on another client would otherwise lose the card on merge. Orphans simply
    don't render.
  - History **restore rebuilds in place**, reusing live Y.Map/Y.Array
    instances. Replacing them wholesale tombstones the subtrees and silently
    discards concurrent/offline edits (found as a HIGH in review, with a
    regression test since).

### Persistence lifecycle

Snapshot (`Y.encodeStateAsUpdate`) loads on first join of a room; saves are
debounced 3s with a 10s max-wait under sustained editing; last disconnect
flushes and evicts the room. Graceful shutdown flushes **all** rooms with a
single-writer rule (the per-connection flush stands down during shutdown — a
detached-flush race was clobbering good snapshots with destroyed-doc encodes
until review caught it). Named history keeps the newest 50 snapshots per
board.

### Auth

- **Email + password** (primary): sign up → 6-digit code mailed (Resend's
  plain HTTP API via `fetch`, no SDK; dev logs the code to console) → verify
  with code + password → intro screen (name + bio) → boards. Passwords are
  scrypt-hashed with Node's stdlib — no bcrypt dependency.
- **GitHub / Google** buttons are wired through Auth.js and activate when the
  four `AUTH_*` env keys are provisioned.
- Sessions are JWTs (an Auth.js constraint of the Credentials provider). The
  trade-off is documented below; board access is still membership-checked per
  request.
- The cross-service flow: `GET /api/rooms/:boardId/ws-token` mints a 5-minute
  HS256 JWT binding room + role; the WS server verifies it at upgrade and
  refuses room mismatches. Clients auto-refresh the token on reconnect.

## Testing story

```bash
npm run test:unit                      # 15 node:test cases (derive/move/restore/caps/rateLimit)
npx tsx scripts/phase1-convergence.ts  # 2-client concurrent-edit convergence (14 checks)
npx tsx scripts/phase2-presence.ts     # cursor propagation, ~20/s throttle, cleanup (9 checks)
npx tsx scripts/phase3-persistence.ts write <room>   # then restart the server and:
npx tsx scripts/phase3-persistence.ts verify <room>  # assert state restored from Postgres
npx tsx scripts/phase4-auth.ts         # token rejects, viewer write-drop server-side (12 checks)
npx tsx scripts/phase5-offline.ts      # IndexedDB replay, restore-vs-offline-edits (8 checks)
npx tsx scripts/phase6-hardening.ts    # own server on :4100 — expiry, 1MB cap, shutdown flush (10 checks)
npx tsx scripts/phase7-emailauth.ts    # auth core vs real Postgres — incl. takeover regressions (27 checks)
```

Each phase also passed an adversarial multi-agent review (independent
reviewers hunting bugs from different angles, findings verified before
fixing). Highlights of what that process caught, by phase: data-loss on
concurrent column delete (Ph1), drag-index semantics (Ph2), in-place restore
(Ph5), an empty-flush race that could wipe a board's snapshot and a
crash-DoS via mid-handshake TCP resets (Ph6), and an account-takeover window
plus a JWT-staleness bug that would have broadcast users' raw email addresses
in presence (Ph7).

## Performance

Honest numbers, measured on the production VPS — placeholders until measured:

| Metric | Value |
|---|---|
| Edit → remote peer render (same region) | `MEASURE` |
| Cursor update rate under sustained drag | ~20/s by design (throttle asserted in the phase-2 harness) |
| Snapshot write amplification (11 rapid edits) | 2 by design — one debounced write + one disconnect flush (the phase-3 harness verifies restored state, not write count) |
| WS server RSS with 1 room / 10 rooms | `MEASURE` |
| Cold board load (Postgres snapshot → first paint) | `MEASURE` |

## Honest limitations

- The WS server does **not** decode CRDT updates to re-validate entity caps —
  a tampered *editor* client can exceed the 50-column/500-card limits (viewer
  writes are dropped regardless). v1 trade-off, documented.
- WS token expiry is checked at handshake only; a live socket outlives its
  token. Reconnects re-verify.
- Auth.js JWTs can't be revoked server-side (Credentials-provider constraint).
  Deleting an account doesn't kill its live sessions; board membership *is*
  re-checked on every sensitive request.
- Rate limiting is in-process (resets on restart) — right-sized for a
  single-node deployment, swap for a shared store if this ever scales out.
- History saves copy the server's latest snapshot, which may lag live edits by
  up to ~10s under sustained editing (3s debounce, 10s max-wait).
- No block-level permissions, comments, or notifications — this is a kanban +
  (upcoming) docs tool, not Notion parity.

## Repo layout (npm workspaces)

```
collabcanvas/
├─ web/               # Next.js 16 App Router (strict TS) — UI, auth, API routes
├─ ws-server/         # Node + TS WebSocket sync server (hand-rolled y-websocket v3 handler)
├─ packages/shared/   # Shared types + LIMITS (BoardData, presence, JWT claims)
├─ packages/db/       # Prisma 7 schema + generated TS client (shared by web + ws-server)
├─ scripts/           # Headless verification harnesses (see Testing)
├─ deploy/            # Self-hosting kit: runbook, Caddyfile, WinSW XMLs, env templates
└─ docs/              # Design brief (UI contract) + roadmap
```

The visual layer is intentionally swappable: all sync/CRDT/presence logic
lives in a framework-agnostic core (`web/lib/yjs` — the harnesses run it in
plain Node) exposed through thin React hooks (`web/lib/board`), and the
presentational components contain **zero** Yjs imports. The UI contract lives
in [`docs/claude-design-brief.md`](docs/claude-design-brief.md); the current
visuals (warm-cream neo-brutalist, light/dark, Fredoka + Space Grotesk) were
designed in Claude Design and ported against that contract.

## Local development

```bash
npm install            # from repo root — links all workspaces

npm run dev            # web app        → http://localhost:3000
npm run dev:ws         # WS server      → http://localhost:4000 (/health)
npm run dev:all        # both at once

npm run typecheck      # strict TS across all workspaces
npm run test:unit      # unit tests
```

1. Copy `web/.env.example` → `web/.env.local` and
   `ws-server/.env.example` → `ws-server/.env`. `AUTH_SECRET` and a shared
   `WS_JWT_SECRET` (identical in both files) are the only secrets you invent.
2. `npm run db:start --workspace=packages/db` runs a local Prisma Postgres
   (no Docker) — paste the `DATABASE_URL` it prints into both env files;
   `npx prisma db push` from `packages/db` syncs the schema.
3. Sign up with any email — without `RESEND_API_KEY` the verification code is
   printed to the web server's console.

Optional: provision GitHub/Google OAuth apps (callbacks
`/api/auth/callback/{github,google}`) and fill the four `AUTH_*` keys;
provision [Resend](https://resend.com) and set `RESEND_API_KEY` + `EMAIL_FROM`
for real verification emails.

## Deployment

Self-hosted on a Windows VPS: Caddy terminates TLS for both hostnames, WinSW
runs the web and WS processes as services, Postgres 17 runs locally on the
box. The complete runbook — from blank server to certificates — is in
[`deploy/README.md`](deploy/README.md).

## Build log

| Phase | Shipped | Verified by |
|---|---|---|
| 0 | Monorepo scaffold, strict TS, `/health` | typecheck + boot |
| 1 | Yjs doc model, `deriveBoardView`, dnd-kit board, WS sync server | 14-check convergence harness |
| 2 | Presence: live cursors, editing badges, throttling | 9-check harness |
| 3 | Postgres snapshots: load/debounce/flush lifecycle | kill-and-restore harness |
| 4 | Auth.js, dashboard, share roles, ws-token flow, server-side viewer write-drop | 12-check harness |
| 5 | Offline-first provider, reconnection UX, named history + restore | 8-check harness |
| 6 | Hardening: rate limits, caps, 1MB WS cap, logs, graceful shutdown | 15 unit + 10-check harness |
| — | Design port (Claude Design, neo-brutalist) · VPS deploy (live) | visual + prod e2e |
| 7 | Email+password auth: mailed verification codes, intro onboarding, JWT sessions | 27-check harness + live flow |
| 8 | This write-up | you're reading it |

Next up (Notion-lite track): rich collaborative card descriptions (TipTap +
y-prosemirror) → doc pages → workspaces → typed databases → views/charts →
formulas. Roadmap in [`CLAUDE.md`](CLAUDE.md).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Yjs · y-websocket ·
y-indexeddb · y-protocols · Postgres 17 · Prisma 7 · Auth.js v5 · @dnd-kit ·
Tailwind v4 · Caddy · WinSW.
