# CollabCanvas — Working Context (living document)

> **Maintenance protocol (user-mandated):** update this file after EVERY
> completed unit of work — feature built, test passed, bug fixed, review
> triaged — with what changed and the current state. This is the
> pick-up-where-you-left-off document: read it first, trust it over memory,
> and never declare a phase done without updating it.

## What this is

Real-time collaborative kanban (portfolio project, spec-driven, built in
phases with acceptance tests). Growing into a "Notion-lite" workspace after
hardening + deploy. Honesty over feature count; verify library APIs against
installed versions, never from memory; every phase gets an adversarial
multi-agent review before it's called done.

## Monorepo map

```
web/              Next.js 16 App Router (React 19, Tailwind v4, Auth.js v5 beta, strict TS)
ws-server/        Node WS sync server (hand-rolled y-websocket v3 protocol handler — v3 ships no server)
packages/shared/  Plain TS types (BoardData, PeerPresence, WsTokenClaims, ConnectionStatus)
packages/db/      Prisma 7 schema + generated client (@prisma/adapter-pg), shared by web + ws-server
scripts/          Headless verification harnesses (see "Testing")
deploy/           Complete VPS deploy kit (runbook, Caddyfile, WinSW XMLs, env templates, PS scripts)
docs/             claude-design-brief.md (UI contract) · deploy-and-portfolio-plan.md (roadmap)
```

## Version log

| When | What | Verified by |
|---|---|---|
| Phase 0 | Monorepo scaffold, strict TS, /health | typecheck + boot |
| Phase 1 | Yjs doc model (§3), deriveBoardView (dedupe/orphans), useBoard, dnd-kit board, WS server handler | scripts/phase1-convergence.ts (14 checks) |
| Phase 2 | Presence: cursors (content-space coords), editing badges, PresenceBar, ~20/s throttle | scripts/phase2-presence.ts (9 checks) |
| Phase 3 | Postgres snapshots: load on first join, debounced 3s save (+10s max-wait), flush+evict on last disconnect | scripts/phase3-persistence.ts write/verify |
| Phase 4 | Auth.js (GitHub+Google) + Prisma adapter, boards dashboard, share (editor/viewer), ws-token JWT (5 min), server-side viewer write-drop | scripts/phase4-auth.ts (12 checks) |
| Design | Claude Design delivery ported (neo-brutalist cream theme, light/dark, Fredoka/Space Grotesk); guest palette = design bands | visual + all harnesses |
| Phase 5 | Offline-first provider (y-indexeddb; renders with zero network; WS attaches on token, retries offline, 401/403→fail screen), offline/reconnecting status split, snapshot history (save=server-copy, restore=in-place hard reset), HistoryPanel | scripts/phase5-offline.ts (8 checks incl. restore-vs-offline-edits regression) |
| Phase 6 | Hardening: shared LIMITS (50 cols/500 cards/title lengths) clamped in mutations; in-memory rate limiter (web/lib/rateLimit.ts) on ws-token (30/min), history save (10/min), share (20/min + email/role runtime validation), create board (20/min); ws-server 1MB message cap (closes conn), structured JSON-line logs (src/log.ts), graceful shutdown SIGINT/SIGTERM/SIGBREAK + guarded POST /__shutdown (WS_ENABLE_TEST_SHUTDOWN=1) flushing ALL rooms, /health now {rooms, uptimeSec} | scripts/unit/yjs.test.ts (14 node:test) + scripts/phase6-hardening.ts (10 checks: token-expiry reconnect mechanics, oversized close, shutdown flush) |
| Reviews | Ph1: 3 fixes (deleteColumn data-loss, stale store snapshot, drag index). Ph2: 7 fixes (drag index REVERTED to full-list/arrayMove semantics — decisive test: [A,B] drag A onto B must give [B,A]; unmount editing badge; self-change re-renders; cursor overlay clip; clientId keys; guarded blur; scroll republish). Ph5: 9 fixes (restore rebuilds IN PLACE — replacing Y.Map instances tombstones subtrees and loses concurrent/offline edits; token-refresh on connection-error/close (401 upgrades emit no 'disconnected'); snapshot max-wait; fetch error handling; history retention prune at 50; moveColumn self-heals duplicates; sticky outage status) | all harnesses re-run green after each |
| Ph6 review | 8 fixes + 1 found-while-fixing: (1) HIGH empty-flush wipe — `WSSharedDoc.snapshotLoaded: Promise<boolean>` now gates EVERY snapshot write (closeConn flush, debounced schedule, flushAllRooms); a failed load disables writes for that room. (2) HIGH upgrade-handler crash-DoS — socket 'error' listener during async token verify (ws README pattern). (3) owner can't be demoted (shareBoard guard). (4) wss maxPayload:1MB (app check kept as belt). (5) card cap counts VISIBLE cards, not orphans (visibleCardCount). (6) shutdown order: markShuttingDown() → close clients → flushAllRooms (single writer — closeConn stands down during shutdown; the detached-flush race clobbered good snapshots with destroyed-doc encodes). (7) honest flush tally + awaitInFlightWrites before exit. (8) at-cap composers explain instead of eating input. (+) live connections needed a ws 'error' listener too — any TCP reset crashed the process | unit 15/15, phase6 harness 10/10, p1–p5 re-run green against fixed server |

## Running & testing

```bash
npm run dev            # web :3000        npm run dev:ws   # ws :4000 (tsx watch)
npm run start:ws       # ws once          npm run build --workspace=web
npm run typecheck      # all workspaces   npm run lint --workspace=web
npm run db:start --workspace=packages/db  # local Prisma dev Postgres :51214
```

Harnesses (ws-server must be running; they mint editor JWTs via scripts/mintToken.ts):
```bash
npx tsx scripts/phase1-convergence.ts
npx tsx scripts/phase2-presence.ts
npx tsx scripts/phase3-persistence.ts write <room> && npx tsx scripts/phase3-persistence.ts verify <room>
npx tsx scripts/phase4-auth.ts
npx tsx scripts/phase5-offline.ts      # uses fake-indexeddb; includes restore-vs-offline regression
npx tsx scripts/phase6-hardening.ts    # spawns its OWN server on :4100 (token expiry, 1MB cap, shutdown flush)
npm run test:unit                      # 14 node:test cases (dedupe/move/restore/caps/rateLimit)
```

**Gotchas that have burned us:**
- Zombie processes: tsx/next children SURVIVE session restarts and hold :3000/:4000
  with STALE code → mystery failures. Before debugging "regressions", kill the
  port owners (`Get-NetTCPConnection -LocalPort 4000`) and start fresh.
- The local dev DB (prisma dev, :51214, db `template1`) is disposable — it has
  been recreated and lost all rows at least once. Never debug "missing data"
  locally as a code bug before checking the DB actually has rows.
- `prisma migrate dev` FAILS against the local dev DB (P1017 shadow-DB quirk) —
  use `prisma db push`. Real migrations only when the VPS Postgres exists.
- Since Phase 4, BoardSnapshot has an FK to Board — harness rooms must create
  real User+Board rows (phase3 harness does this via ensureBoardRow).
- `web/lib/boards.ts` imports "server-only" — it CANNOT be imported by
  tsx harnesses; hit Prisma directly in scripts instead.
- Root package.json is CJS — scratch .ts scripts need async main(), no top-level await.

## Architecture crib sheet

- **Doc model** (web/lib/yjs/schema.ts is the ONLY place that knows field names):
  meta Y.Map {title, updatedAt} · columnOrder Y.Array<colId> · columns Y.Map<colId, Y.Map{id,title,cardOrder:Y.Array}> · cards Y.Map<cardId, Y.Map{id,title,description,createdBy}>.
  Order in arrays, entities in flat maps; every multi-step mutation in ONE doc.transact;
  never replace a Y type with a plain value. deriveBoardView = single render source
  (dedupes duplicate ids, drops orphans/missing refs deterministically).
- **deleteColumn does NOT delete card entities** (concurrent moveCard would lose the
  card on merge — Ph1 review). Orphans just don't render.
- **Restore = in-place rebuild** (web/lib/yjs/restore.ts) — reuse live Y.Map/Y.Array
  instances so concurrent/offline edits merge into live subtrees (Ph5 review HIGH).
- **dnd-kit index math**: over item's FULL-list index == arrayMove `to` index ==
  moveCard/moveColumn insertion index. Decisive test: [A,B] drag A onto B → [B,A].
- **Provider** (web/lib/board/BoardRoomProvider.tsx): doc+idb+stores created
  synchronously (offline-first render); WS attaches async with 5-min JWT from
  /api/rooms/:id/ws-token; token refreshed on connection-error/close/online
  (throttled 10s); status: connecting (pre-first-sync) / connected / disconnected
  (sticky through retry cycles) / offline (navigator.onLine).
- **UI contract**: components under web/components/ are pure (ZERO Yjs imports);
  hooks: useBoard(id)→{data,actions,status,canEdit}, usePresence()→{peers,setCursor
  (throttled internally ~20/s),clearCursor,setEditing}. Contract doc:
  docs/claude-design-brief.md. Cursor coords are board-CONTENT space.
- **ws-server**: rooms keyed by URL path (`board:<id>`); JWT verified at upgrade
  (401 pre-handshake); viewers' syncStep2/update messages DROPPED server-side;
  snapshots: load on room create, save debounced 3s (max-wait 10s), flush+evict
  on last disconnect; missing Board row (P2003) = warn+skip, not error.
- **History**: save copies BoardSnapshot server-side (≤~10s stale under sustained
  editing — documented); retention = newest 50 (pruned on save); restore fetches
  base64 bytes and transplants client-side.

## Current state (2026-07-03)

- **Phases 0–6 DONE** — built, adversarially reviewed, all findings fixed and
  re-verified (unit 15/15, harnesses p1–p6 green, typecheck/lint/build clean).
- Phase 6 accepted limitations (documented, honest): rate limiter is
  in-process (fine: single-node VPS); ws-server does not decode CRDT updates
  to re-validate entity caps (tampered client can exceed); token expiry is
  checked at handshake only (live sockets outlive their token).
- Local dev DB note: the prisma-dev instance half-died again (accepts TCP,
  kills queries) — killing the PID and `npx prisma dev -d` from packages/db +
  `npx prisma db push` recovers it (data is disposable).
- **NEXT: Phase 8 README** (portfolio write-up, MEASURE placeholders), then
  deploy on green light, then Notion-lite N1.
- **VPS DEPLOY FROZEN by user** until their landing page is ready — do NOT ssh
  to 144.172.98.43 until explicit green light. Box state + full runbook:
  deploy/README.md (Node 22.23.1 ✓, PG 17.7 binaries but NO service, leftovers:
  pginstall task + C:\pg-setup.exe + C:\node-setup.msi). Targets:
  collabcanvas.dash-board.in + collabcanvas-ws.dash-board.in behind shared Caddy.
  User-side prerequisites: OAuth apps (callbacks .../api/auth/callback/{github,google}),
  provider firewall 80/443. Portfolio at dash-board.in root = user's own project.

## Notion-lite roadmap (after Phase 6 + deploy) — user-expanded scope

User asks (2026-07-02): per-user databases, team vs private switching, tables,
charts, formulas, "and more". NOT built yet — sequenced to keep each step
shippable on the same CRDT/presence/offline stack:

| Phase | Feature |
|---|---|
| N1 | Rich text card descriptions: TipTap + y-prosemirror on Y.XmlFragment (links, lists, marks; collaborative text cursors) |
| N2 | Doc Pages: `page:<id>` rooms, full-page TipTap editor, sidebar (boards + pages) |
| N3 | Workspaces: Private vs Team sections (schema: Workspace{type} → boards/pages), share at workspace level, switcher UI |
| N4 | Databases: typed tables as first-class collaborative entities (columns: text/number/select/date/checkbox; rows in Yjs; table view) |
| N5 | Views + charts over databases (filter/sort/group; bar/line/pie via derive pattern — use the dataviz skill when building) |
| N6 | Formulas: computed columns (small expression parser; sum/avg/count/if/concat), inline tables in pages, slash-command menu |

Honest scope line: no block-level permissions, no comments/notifications, no
full Notion parity — "a lite Notion, functionally" per user.

## Hard rules

1. Phase cadence: build → verify (harness/acceptance) → adversarial review →
   fix confirmed findings → re-verify → update THIS FILE → report pass/fail.
2. No Yjs/awareness imports in presentational components — ever.
3. Verify every library API against the INSTALLED version before use.
4. Don't fabricate metrics; label placeholders `MEASURE`.
5. Update this file + memory before ending any work session.
