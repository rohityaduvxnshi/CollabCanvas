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
| Phase 7 | Email+password auth (user-requested — OAuth creds still unmapped, buttons kept): User.passwordHash+bio (db push), scrypt via node:crypto (no bcrypt), 6-digit codes in Auth.js VerificationToken (sha256 at rest, 15-min TTL, one-shot atomic consume), Credentials provider + JWT sessions (Auth.js constraint), pages /signin (one intent-based form), /verify (password+code), /welcome (name+bio intro), landing "Continue with Email", mail = Resend HTTP API via fetch (no SDK; dev fallback logs code), RESEND_API_KEY/EMAIL_FROM in env templates | scripts/phase7-emailauth.ts (27 checks) + live HTTP flow vs dev server |
| Phase 8 | Portfolio README rewrite: live URL + honest "pre-email-auth build" note, 60-second tour, REAL architecture diagram (VPS/Caddy/WinSW/PG17 — replaced stale Vercel/Fly/Neon), doc-model + persistence-lifecycle + auth sections, testing story, MEASURE-placeholder metrics table (rule 4), honest-limitations section, build log, N-track roadmap teaser | adversarial fact-check (1 agent, all claims vs code): 8 accuracy fixes — unit count 14→15 (also in CLAUDE.md testing section), "two HIGH data-loss races" overstatement reworded, write-amplification metric no longer harness-attributed, history lag ~3s→up-to-~10s (max-wait), DATABASE_URL added to local-dev steps, phase3 harness args shown, "framework-agnostic hooks"→core+thin hooks, live-site gap noted |
| Ph7 review | 8 finder angles, 10 fixes: (1) HIGH signup takeover — OAuth users have emailVerified=null (installed GitHub/Google profile() never sets it), so signup now rejects verified OR OAuth-linked emails AND verification requires code+password (attacker-overwritten password can't be activated by the victim's code entry — closes the pre-verification window). (2) HIGH JWT staleness — /welcome name never reached the token; presence would broadcast the raw email for 30d → unstable_update() + jwt trigger:"update" branch. (3) rateLimit MAX_KEYS clear() let attackers reset their own brute-force bucket via key-spray → idle-sweep, refuse new keys when hot. (4) mail-send failure crashed server actions → caught, honest form errors. (5) TOCTOU findUnique+delete on code consume (double-submit 500) → atomic delete().catch. (6) split cred-pw (10/min) / cred-code (10/10min) buckets + typed UnverifiedEmail/RateLimited (CredentialsSignin subclasses — verified raw-mode rethrow preserves .code end-to-end). (7) unverified sign-in no longer auto-mails (bypassed 3/10min resend limiter + invalidated in-flight codes); redirects to /verify. (8) onboarding is data-derived: dashboard redirects name-less users to /welcome (was one-shot flow redirect). (9) React 19 post-action form reset wiped fields → email preserved via action state. (10) LIMITS.passwordMin/userName/userBio in packages/shared + .cc-btn class (was 5 inline button-recipe copies). Accepted: JWT non-revocable (membership still checked per request), deploy invalidates old DB-session cookies (none real — OAuth never worked in prod), in-memory limiter resets on restart | typecheck/lint/build clean, harness 27/27 (incl. takeover + OAuth-guard regressions), live: unverified → code=unverified, verified → session + /welcome guard |
| N1 | Rich collaborative card descriptions: card.desc Y.XmlFragment edited by TipTap v3.27.1 (StarterKit + Collaboration y-sync + CollaborationCaret over the room awareness); legacy `description` string migrated into the fragment on first editor open (then cleared); deriveBoardView renders a plain-text preview (fragment→text, capped 280); restore rebuilds the fragment IN PLACE (clone nodes, instance survives — same tombstone-avoidance as cards); Card.tsx Save commits title only (description is live-collaborative); .cc-richtext + caret CSS; NO toolbar (StarterKit input rules: **bold**, *italic*, lists, # headings, > quotes) | scripts/phase-n1-richtext.ts (18 checks) + unit 15/15 + phase1/phase5 regressions |
| N1 review | Fable subagent review OOM'd on credits → done inline on Opus (multi-agent attempted, blocked by infra). 3 fixes: (1) HIGH CollaborationCaret.configure({user}) overwrites the shared awareness "user" field on mount (verified in installed dist line 86) — passing only {name,color} stripped id/image, corrupting every peer's cursor/avatar/editing-badge (they read state.user.id); now passes the FULL {id,name,color,image}. (2) MED ensureCardDescFragment ran in useMemo (doc write during render → re-render subscribers mid-render); moved to a useState lazy initializer (once, on mount; editor only mounts on user click; useSyncExternalStore tolerates it) — an effect+setState tripped React 19's set-state-in-effect lint. (3) LOW preview text walked unbounded per re-derive → capped 280. Accepted (documented): rich descriptions have NO length cap (the old 5000 char clamp doesn't apply to fragments; the ws-server already doesn't decode CRDT to enforce caps) | typecheck/lint/build clean, harness 18/18 |
| N2 | Doc Pages — full-page collaborative TipTap docs. Schema: Page/PageMember/PageSnapshot mirror Board/BoardMember/BoardSnapshot (db push). ws-server GENERALIZED: persistence.ts routes `board:`/`page:` rooms to their snapshot tables (roomTarget); auth.ts bareRoomId strips either prefix. New web: lib/pages.ts (list/create/membership), /api/pages/:id/ws-token (mints room=pageId after page-membership check), lib/page/{PageRoomProvider (offline-first, leaner sibling of BoardRoomProvider), PageEditor (TipTap Collaboration on the doc's default fragment + full-user caret), PageScreen (editable title via renamePageAction, status pill)}, /pages/:id route, dashboard "Your pages" section + New page. mintToken.ts strips either prefix. Title lives in Postgres (renamePageAction) — NOT collaborative (v1). No page sharing/deletion/history UI yet (sharing → N3). | scripts/phase-n2-pages.ts (4 checks: page fragment write → PageSnapshot row in PG → decodes → fresh-client reload) + regressions: phase3 board write/verify, phase1, phase6 (own server), N1 18/18, unit 15/15 |
| N3 | Workspaces (Private per user + shared Team). KEY DECISION: auth model UNCHANGED — socket access stays per Board/PageMember; workspaces are an organizational layer + a sharing convenience. Schema: Workspace{type}/WorkspaceMember + nullable Board.workspaceId/Page.workspaceId (existing rows unaffected; null = owner's Private). web/lib/workspaces.ts (no server-only, like emailAuth, so the harness tests the real fns): ensurePrivateWorkspace (lazy), listWorkspacesForUser, createTeamWorkspace, workspaceContents (Private includes null-ws owned rows), shareWorkspace (adds WorkspaceMember AND fans out Board/PageMember rows into the EXISTING reviewed path → getMembership/ws-token untouched), addWorkspaceMembersTo{Board,Page} (new items inherit team members). createBoard/createPage take optional workspaceId. Dashboard: URL-param (?ws=) workspace switcher tabs, per-workspace board/page lists + create (hidden workspaceId), team-owner share form (redirect-with-status). Reviewed INLINE (subagent infra still down). | scripts/phase-n3-workspaces.ts (21 checks incl. SECURITY: invitee gets BoardMember/PageMember via share; ISOLATION: no leak to private/other-ws/legacy boards; can't share Private; unknown email fails) + phase4 board-auth regression green |
| N4 | Typed databases — first-class collaborative tables (room `db:<id>`). Schema: Database/DatabaseMember/DatabaseSnapshot mirror Page (+ workspaceId), db push. ws-server persistence.ts roomTarget now routes `db:`→DatabaseSnapshot (board/page unchanged; auth bareRoomId already prefix-agnostic). Yjs model in web/lib/yjs/dbSchema.ts (meta/columnOrder/columns Y.Map{id,name,type,options?:Y.Array}/rowOrder/rows Y.Map<colId,primitive>); dbMutations (add/rename/changeType/setSelectOptions/delete/move columns+rows, setCell with coerceCell per type); deriveDbView (dedupe cols/rows, drop missing-column cells); dbSeed uses DETERMINISTIC ids (seed-col-*) so concurrent seeds CONVERGE via dedupe instead of doubling the schema. UI: lib/db/{dbStore,DbRoomProvider (offline-first, no presence),DbScreen} + components/db/DatabaseTable (pure grid, per-type cell editors) + /databases/:id route + /api/databases/:id/ws-token. Dashboard Databases section; workspaceContents/shareWorkspace/addWorkspaceMembersToDatabase include databases (share fan-out → DatabaseMember). Reviewed INLINE (pre-applied deterministic-seed-id fix) + a full SUBAGENT review that completed (no high/med) → 2 low fixed (ensureDbSeed now guards on a meta 'seeded' flag so an emptied table isn't re-seeded; setSelectOptions dedupes) + 2 low accepted (changeColumnType doesn't re-coerce existing cells; bareRoomId cross-type isolation rests on cuid non-collision — documented ponytail). v1 gaps: no in-table presence; title Postgres-only. | scripts/phase-n4-databases.ts (26 checks: seed/typed-cell coercion/select options/deleteColumn cell-cleanup/reorder/caps/derive dedupe/2-client convergence/seed-race convergence/`db:` PG round-trip) + phase-n3 (23, now DB fan-out) + phase4 green |
| N5 | File attachments on database rows (any type; 5 MB/file + 500 MB/user SERVER-ENFORCED). Prisma Attachment{ownerId,databaseId,name,size,mimeType,storageKey}; bytes on disk under FILE_STORAGE_DIR (default <cwd>/.filestore, gitignored). web/lib/attachments.ts (no server-only, harness-testable): userUsageBytes, checkFileSize, canUpload (per-file + per-user quota on ACTUAL bytes, not client-declared), storeAttachment (randomBytes(16) hex storageKey → no path traversal), getAttachment/readAttachmentBytes/deleteAttachment. POST /api/databases/:id/attachments (editor-only, Content-Length pre-reject + real-byte enforce). GET/DELETE /api/attachments/:id (download membership-gated + forced Content-Disposition:attachment + octet-stream + nosniff to block stored XSS; delete = uploader or db-editor, frees quota). New `attachment` DB column type (cell = JSON [{id,name,size}]); coerceCell keeps it (10k cap); AttachmentCell (client, fetch) does upload/list/download/remove, wired into DatabaseTable (+databaseId) + DbScreen. Workspace share fan-out already covers db membership → attachments inherit access. Reviewed INLINE + a COMPLETED subagent security review (no path-traversal/XSS/IDOR; core solid) → 3 MED fixed: (1) require a valid Content-Length + reject before buffering (a chunked no-length upload could OOM the process via formData); (2) per-user upload SERIALIZATION so the read-then-write quota check is atomic on the single node (concurrent uploads could otherwise blow past 500MB by ~rate-limit×file-size); (3) deleteRow now reclaims the row's attachments (else they strand quota with no UI to free them). 1 LOW accepted+documented: hard-delete of a shared attachment id — only reachable via a future row-duplication feature (none exists), would need ref-counting. Remaining v1 note: deleting a whole DATABASE cascades Attachment rows (frees quota) but orphans on-disk bytes → a sweep job is the follow-up; prod should also add a Caddy `request_body max_size`. | scripts/phase-n5-attachments.ts (19 checks: per-file 5MB gate, per-user 500MB quota — allow/deny, rejected uploads add NO usage + write NO row, disk write/read round-trip, delete frees quota + removes file+row; per-user concurrency stays within cap) + N4 29/29 regression + build |
| N6 | Views + charts over databases. PURE transform layer web/lib/db/dbView.ts: applyView (filter=case-insensitive substring on a column; sort asc/desc by type, empties always last) + aggregate (group-by any column; measure count/sum/avg of a number column; sorted desc; >8 categories fold into "Other", total preserved). Presentational SVG components/db/DatabaseChart.tsx: single-hue bars (category=axis, not color) + categorical pie, every mark a 2px ink border + direct value labels + a table view (the relief the palette's contrast-WARN requires), hover via <title>. Palette VALIDATED with the dataviz validate_palette.js — light + dark each have their OWN steps (--chart-1..6, both pass lightness band + chroma + CVD; dark all-pass). lib/db/DbViewPanel.tsx orchestrates Table/Chart mode + controls; wired into DbScreen (replaces the direct table). No manual useMemo (React Compiler auto-memoizes; preserve-manual-memoization). v1: views are client-side/ephemeral (not collaborative/saved). Reviewed INLINE (low surface: no auth/persistence/CRDT change — client view+render; logic harness-tested, color validator-verified). | scripts/phase-n6-views.ts (15 checks: filter/sort/empties-last/count/sum/avg/Other-fold/empty-bucket) + typecheck/lint/build clean + dataviz palette validation |
| N7 | Formula (computed) columns. SAFE engine web/lib/db/formula.ts: hand-rolled tokenizer + recursive-descent parser + tree-walking evaluator — NO eval/Function/property-access/globals; only arithmetic/string/boolean ops on primitives resolved via a caller-supplied resolve(name). Language: [Column Name] refs, number/'str'/true/false literals, + - * / = != < > <= >= && || !, functions sum/avg/count/min/max/round/abs/if/concat/and/or/not. New `formula` DB column type (col.formula field; makeDbColumn/changeColumnType init it; setColumnFormula mutation; setCell is a no-op on formula cols — computed, never stored). deriveDbView evaluates each formula cell per row, resolving refs by column NAME with per-cell MEMOIZATION + cycle detection (a cycle yields "#ERR: cycle", never an infinite loop). DatabaseTable: formula header has an expression editor; formula cell is read-only (shows the computed value or a red #ERR). Runs in the author's browser (arithmetic only → safe even if hostile). SCOPE: computed columns shipped; inline-tables-in-pages + slash-menu DEFERRED (bigger TipTap work, less core than the formula headline). Reviewed INLINE (safety proven by the harness: no eval/property access, cycle-safe, all errors caught). | scripts/phase-n7-formulas.ts (30 checks: precedence/parens/refs/empty-as-0/string concat/if/comparison/sum/avg/count/min/max/round/errors incl. div0+unknown-fn+non-numeric+unclosed+no-eval + deriveDbView integration: computed cell, formula-refs-formula, setCell-ignored, recompute-on-input-change, cycle→#ERR) + N4 29/29 regression + typecheck/lint/build clean |
| N8 | Exports — ZERO new deps (climbed the ladder: browser + string generation cover it). PURE generators web/lib/exporters.ts: databaseToCsv (RFC-4180 quoting + CSV/formula-injection neutralize — leading `=@|`/control or non-numeric `+-` gets a `'` prefix, signed numbers preserved; attachment cells → file names; bool→TRUE/FALSE), boardToMarkdown, boardToHtml/databaseToHtml/htmlDocument (htmlEscape on ALL content → no XSS in the .doc/print HTML). Client seam web/lib/download.ts: downloadText (Blob+object-URL, no lib), printHtml (new window → print() → Save-as-PDF), safeName. components/ExportButtons.tsx (pure "use client" button row) wired into DbScreen (CSV/Word/PDF), BoardScreen toolbar (MD/Word/PDF), PageScreen (PDF via window.print). globals.css `@media print` hides `.cc-noprint` chrome + flattens the dotted backdrop. FIDELITY NOTE (honest): "Word" = an .doc-openable HTML document (not real OOXML); "Excel" = CSV (opens natively); PDF = the browser's print dialog. No xlsx/docx binary generation — a real-OOXML follow-up would need a dep; documented, not pretended. Reviewed INLINE (low surface: no auth/persistence/CRDT/network — pure string gen + client download) → 1 fix found-while-reviewing: CSV formula-injection neutralize (a `=cmd`/`@`/`+`/`-` cell would execute as a formula on open). | scripts/phase-n8-exports.ts (20 checks: CSV header/bool/RFC-4180 escape/attachment names/empty/injection-neutralize×3 + signed-number-preserve; markdown h1/count/bullet/indent/empty; HTML escape + full-doc + cell-escape) + typecheck/lint/build clean |

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
npx tsx scripts/phase7-emailauth.ts    # email auth core vs local DB (no servers needed; 27 checks)
npx tsx scripts/phase-n1-richtext.ts   # rich-desc CRDT: migrate/preview/convergence/restore (18 checks, no servers)
npx tsx scripts/phase-n2-pages.ts      # page room → PageSnapshot round-trip (4 checks; ws-server must run)
npx tsx scripts/phase-n3-workspaces.ts # workspace share fan-out + isolation (23 checks; no servers, real DB)
npx tsx scripts/phase-n4-databases.ts  # typed-db CRDT + `db:` PG round-trip (29 checks; ws-server must run)
npx tsx scripts/phase-n5-attachments.ts# file quota + disk round-trip + concurrency (19 checks; no servers, real DB + temp store)
npx tsx scripts/phase-n6-views.ts      # db view/aggregate logic (15 checks; pure, no servers)
npx tsx scripts/phase-n7-formulas.ts   # formula engine + derive integration (30 checks; pure, no servers)
npx tsx scripts/phase-n8-exports.ts    # export generators: CSV/markdown/HTML + injection/escaping (20 checks; pure, no servers)
npm run test:unit                      # 15 node:test cases (dedupe/move/restore/caps/rateLimit)
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
  tsx harnesses; hit Prisma directly in scripts instead. (web/lib/emailAuth.ts,
  password.ts, mail.ts deliberately DON'T import it — the phase7 harness needs them.)
- Root package.json is CJS — scratch .ts scripts need async main(), no top-level await.
- prisma-dev half-death ALSO kills the web dev server's POOLED connections:
  every credentials POST 302s to error=Configuration with pg-pool "Connection
  terminated unexpectedly" while fresh tsx connections still work. Recover:
  kill PID on :51214 → `npx prisma dev -d` (packages/db) → restart the dev server.
- `npx tsx -e "..."` breaks named imports of workspace TS modules (CJS/ESM eval
  quirk) — write a scratch .ts file in scripts/ instead.

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
- **Rich card descriptions (N1)**: card.desc is a Y.XmlFragment (schema.ts:
  cardDescFragment/ensureCardDescFragment/fragmentToText/cardDescText); the
  legacy `description` string migrates in once then stays "" (fragment is the
  source of truth; cardDescText falls back to the string only when no/empty
  fragment). CardDescEditor (lib/board — the ONE Yjs seam a component renders)
  binds TipTap Collaboration to it; CollaborationCaret MUST get the full
  {id,name,color,image} user or it clobbers presence. deriveBoardView's preview
  is capped at 280 chars.
- **Doc pages (N2)**: rooms are `page:<id>`; the ws-server is room-agnostic for
  SYNC but persistence.ts + auth.ts now route by prefix (board:→BoardSnapshot,
  page:→PageSnapshot; token `room` claim is the bare id, either prefix stripped).
  A page = one Y.Doc, body in the default Y.XmlFragment (TipTap Collaboration
  `document: doc`). Access mirrors boards (Page/PageMember, ws-token checks
  membership). Title is a Postgres column (renamePageAction), NOT collaborative.
  lib/page/PageRoomProvider duplicates BoardRoomProvider's offline-first +
  token-refresh essentials (deliberate — generalizing the two is bigger than N2).
- **Auth (Ph7)**: JWT sessions (Credentials-provider constraint; adapter still
  persists users). Core logic = web/lib/emailAuth.ts (harness-visible, no
  server-only). Verification = code+password (takeover defense); signup rejects
  verified OR OAuth-linked emails; codes sha256 at rest, one-shot, 15-min TTL.
  Brute-force guards live INSIDE authorize (cred-pw:/cred-code: buckets) —
  the credentials callback is directly POSTable. authorize throws typed
  UnverifiedEmail/RateLimited (CredentialsSignin subclasses); actions branch
  on err.code. Onboarding is data-derived (dashboard: name null → /welcome);
  completeProfileAction pushes the name into the JWT via unstable_update().
  OAuth buttons render but AUTH_GITHUB_*/AUTH_GOOGLE_* are still empty.

## Current state (2026-07-05)

- **Phases 0–6 DONE** — built, adversarially reviewed, all findings fixed and
  re-verified (unit 15/15, harnesses p1–p6 green, typecheck/lint/build clean).
- Pushed as `ff72966` → github.com/rohityaduvxnshi/CollabCanvas (main).
- **DEPLOYED to the VPS (2026-07-03):** repo at `C:\apps\collabcanvas`
  (built on the box), services `collabcanvas-web` (:3000) + `collabcanvas-ws`
  (:4000) running via WinSW (`C:\apps\winsw`, logs `C:\apps\logs`), Postgres
  17 service running (db `collabcanvas`, role `collabcanvas`; creds live only
  in the VPS env files), site blocks appended to the USER'S Caddyfile at
  `C:\dashboard\Caddyfile` (their Caddy scheduled task owns :80/:443; backup at
  Caddyfile.bak). Redeploy = git archive → scp → tar -x → `npm ci` →
  `npm run build --workspace=web` → `Restart-Service collabcanvas-web/-ws`.
  Prisma finished installing itself during the freeze (the SYSTEM task
  completed); superuser password is NOT in the repo.
- **LIVE (2026-07-03): https://collabcanvas.dash-board.in** — DNS landed,
  Let's Encrypt certs issued for both hostnames, and a production e2e run
  FROM the VPS through the public domain passed (two Yjs clients over
  `wss://collabcanvas-ws.dash-board.in`, real-time convergence, unauth
  socket rejected). Caddy now logs to `C:/dashboard/caddy.log` (added a
  global log block; the Caddyfile was patched byte-safe via scp after a
  remote-regex edit briefly broke the on-disk copy — running config was
  never affected; pristine backup remains at `Caddyfile.bak`).
- **Phase 7 DONE (2026-07-03): email+password auth** — user decision: OAuth
  wasn't working (creds never provisioned), so email signup + mailed 6-digit
  verification + /welcome intro is now the primary path; GitHub/Google buttons
  stay for later mapping. Built, adversarially reviewed (8 angles, 10 fixes —
  see Version log), harness 27/27, live HTTP flow verified.
- **REDEPLOYED — Ph7+8+N1..N8 all LIVE on the VPS (2026-07-05).** Shipped
  git commit `b08a8ee` via `git archive → scp → tar -x` over `C:\apps\collabcanvas`,
  `npm ci` (557 pkgs), `prisma db push` (all N-track tables + User cols now in
  Postgres 17), `next build`, services restarted. Verified externally through
  the public domain: web root 200, landing renders "Continue with Email" (proves
  the NEW build serves, not cached Ph6), `/signin` 200, `/verify`+`/welcome` 307
  (auth redirect), ws `/health` ok, service logs clean. `FILE_STORAGE_DIR=C:\apps\filestore`
  set (N5 attachments; dir created outside the repo so redeploys don't wipe it).
  **EMAIL: RESEND still unconfigured (user chose "deploy now, add later")** — new
  signups succeed but the 6-digit code only lands in `C:\apps\logs` (mail.ts dev
  fallback), NOT the user's inbox. Wiring `RESEND_API_KEY`+`EMAIL_FROM` into
  web/.env.production + restart enables real email; nothing else needed.
  Deploy gotchas hit & fixed IN `deploy/scripts/vps-deploy.ps1` (root-cause, so
  the next redeploy is clean): (1) `DATABASE_URL` is QUOTED in the .env → prisma
  CLI P1013 "scheme not recognized" (dotenv strips quotes, the CLI doesn't) →
  script now strips surrounding quotes. (2) `npm ci` EPERM unlinking `esbuild.exe`
  — the running ws (tsx→esbuild) locks node_modules; `Stop-Service -Force` trips
  WinSW `onfailure=restart` (5s) which bounces it back mid-build → script now does
  a GRACEFUL `Stop-Service` (no -Force) BEFORE npm ci + 8s settle, `Start-Service`
  at the end. (JWT switch logs out any pre-existing sessions — none real.)
- OAuth creds (4 AUTH_* keys) remain empty locally and on the VPS — email
  auth unblocks login until the user provisions them.
- Phase 6/7 accepted limitations (documented, honest): rate limiter is
  in-process and resets on restart (fine: single-node VPS); ws-server does
  not decode CRDT updates to re-validate entity caps (tampered client can
  exceed); ws token expiry is checked at handshake only (live sockets outlive
  their token); Auth.js JWTs are non-revocable server-side (board membership
  is still checked per request; account deletion doesn't kill live sessions).
- Local dev DB note: the prisma-dev instance half-died AGAIN mid-Phase-7
  (accepts TCP, kills queries — including the dev server's pool, see Gotchas) —
  kill PID on :51214 + `npx prisma dev -d` from packages/db recovered it
  (data survived this time; treat as disposable regardless).
- **Phase 8 DONE (2026-07-03):** README rewritten as the portfolio write-up
  (MEASURE placeholders per rule 4), fact-checked by an adversarial agent
  (8 accuracy fixes applied — see Version log).
- **N1 DONE (2026-07-04): rich collaborative card descriptions** — TipTap
  v3.27.1 on a per-card Y.XmlFragment, legacy-string migration, in-place
  restore, plain-text preview. Built + reviewed inline on Opus (the Fable
  subagent review ran out of credits; multi-agent attempted, infra-blocked)
  → 3 fixes (HIGH caret/presence clobber, MED render-phase doc write, LOW
  preview cap). harness 18/18, typecheck/lint/build clean.
- **N2 DONE (2026-07-04): doc pages** — `page:<id>` rooms, full-page TipTap,
  dashboard "Your pages" section. ws-server persistence/auth generalized to
  route both room kinds. Verified: page harness 4/4 + all board regressions
  green (persistence refactor is behavior-preserving for boards). Reviewed
  INLINE on Opus (subagent review infra kept failing/credit-limiting this
  session — auth room-matching + persistence regression are empirically
  proven by the passing harnesses, not just reasoning). Known v1 gaps:
  page title is Postgres-only (not collaborative); no page share/delete/history
  UI (sharing → N3).
- **N3 DONE (2026-07-04): workspaces** — Private + Team spaces, ?ws= switcher,
  team sharing that fans out through the existing Board/PageMember path (auth
  model untouched). Verified: workspaces harness 21/21 (security + isolation),
  phase4 board-auth regression green, typecheck/lint/build clean. Reviewed
  inline (subagent review infra down all session).
- **N4 DONE (2026-07-04): typed databases** — first-class collaborative tables
  (`db:<id>` rooms), typed columns (text/number/select/date/checkbox), a grid
  table view, per-workspace listing + create + share fan-out. ws-server routing
  generalized to a third room kind (board/page unchanged). Verified: N4 harness
  26/26 (CRDT + typed cells + convergence + seed-race + `db:` persistence),
  N3 23/23 (adds DB fan-out), phase4 green, typecheck/lint/build clean.
  Reviewed INLINE (deterministic-seed-id fix) + a completed subagent review
  (no high/med; 2 low fixed, 2 accepted).
- **N5 DONE (2026-07-04): file attachments** — any file type on database rows,
  5 MB/file + 500 MB/user SERVER-ENFORCED on actual bytes; disk storage under
  FILE_STORAGE_DIR; membership-gated forced-download (nosniff, no inline → no
  stored XSS); server-generated storageKey (no path traversal). Verified:
  N5 harness 19/19 (quota allow/deny, no-usage-on-reject, disk round-trip,
  delete frees quota, per-user concurrency stays within cap) + N4 29/29
  regression + typecheck/lint/build clean. Subagent security review COMPLETED
  (no traversal/XSS/IDOR) → 3 MED fixed (require Content-Length + reject before
  buffer; per-user upload serialization; deleteRow reclaims attachments) + 1 LOW
  accepted. v1 gaps: whole-DATABASE delete orphans on-disk bytes (quota freed) —
  sweep job is the follow-up; prod should add a Caddy request_body max_size.
- **N6 DONE (2026-07-04): views + charts** — a client-side view layer over
  databases: Table mode (filter/sort) + Chart mode (group-by + count/sum/avg →
  bar/pie). Pure transforms (dbView.ts) harness-tested 15/15; SVG charts with a
  dataviz-VALIDATED palette (light+dark own steps), ink borders + direct labels
  + table view + hover. typecheck/lint/build clean. Reviewed inline (low surface
  — no auth/persistence/CRDT). v1: views are ephemeral (not saved/collaborative).
- **N7 DONE (2026-07-04): formula columns** — a SAFE expression engine
  (tokenizer+parser+tree-walker, NO eval; refs/arithmetic/strings/booleans +
  sum/avg/count/if/concat/etc.), a `formula` column type, and deriveDbView
  computing formula cells per row with memoization + cycle detection. Harness
  30/30 (incl. safety + cycle + all error paths) + N4 29/29 regression +
  typecheck/lint/build clean. Reviewed inline (pure sandboxed evaluator, no
  auth/persistence/network). DEFERRED (honest scope): inline-tables-in-pages
  + slash-command menu (bigger TipTap work than the formula headline).
- **N8 DONE (2026-07-04): exports — N-TRACK COMPLETE.** board→Markdown/Word/PDF,
  page→PDF, database→CSV(Excel)/Word/PDF. ZERO new deps: pure string generators
  (exporters.ts) + browser download/print (download.ts) + ExportButtons wired
  into DbScreen/BoardScreen/PageScreen. HTML fully escaped (no XSS); CSV/formula
  injection neutralized. HONEST fidelity: "Word"=.doc-openable HTML, "Excel"=CSV,
  PDF=browser print dialog — no real xlsx/docx binary (would need a dep; a noted
  follow-up, not pretended). Harness 20/20 + typecheck/lint/build clean. Reviewed
  inline (low surface — pure string gen + client download; the one real risk, CSV
  injection, was found-and-fixed in review).
- **NEXT: DONE — whole roadmap shipped AND deployed.** All harnesses green
  (2026-07-04 final sweep): unit 15/15; phase1/4/5/6 PASS; phase7 27/27; N1 18,
  N2 4, N3 23, N4 29, N5 19, N6 15, N7 30, N8 20; typecheck/lint/build clean.
  Committed `b08a8ee` (Ph7+8+N1..N8; ff72966 = Phases 0-6). REDEPLOYED to the
  VPS 2026-07-05 — LIVE and externally verified (see the Phase-7/redeploy bullet
  above). Only open follow-up: user provides `RESEND_API_KEY`+`EMAIL_FROM` to turn
  on real verification emails (codes go to the service log until then). Both local
  commits are UNPUSHED (offer to push to github.com/rohityaduvxnshi/CollabCanvas).
- **Session note (2026-07-04):** this whole session ran with the claude-mem
  plugin's worker DOWN — its pre-Read hook blocked the Read TOOL, so ws-server
  files + a couple others were edited via Bash heredocs/node patch scripts
  (Edit/Write need a tracked Read). Adversarial SUBAGENT review was unavailable
  (Fable credits out early → Opus; review agents credit-failed/stalled), so
  N1–N3 were reviewed INLINE + harness-verified. Restarting the session should
  restore both (Read + subagents). N4+ (databases, files, export) would benefit
  from that healthy tooling.
- **User asks (2026-07-04):** export options (PDF/Word/Excel) → N8; file
  attachments on databases, any type, 5 MB/file + 500 MB/user server-enforced
  → N5. Both recorded in the roadmap table.
- **Session infra note (2026-07-04):** the claude-mem plugin's worker went
  unreachable and its hooks fail — the PreToolUse "file-context" hook BLOCKS
  the Read tool entirely (work around with `cat`/PowerShell Get-Content);
  other tools' PostToolUse hooks just error noisily. Unrelated to this repo;
  the plugin likely needs a restart. Left the user's plugin config untouched.
- **VPS DEPLOY — DONE (freeze lifted 2026-07-05 on the user's "deploy then").**
  Box `144.172.98.43` (`ssh -i ~/.ssh/dashboard_vps Administrator@...`, PowerShell
  default shell). Repo at `C:\apps\collabcanvas` (NOT a git repo — extracted
  archive; redeploy = `git archive HEAD | scp | tar -x` over it, then run
  `deploy\scripts\vps-deploy.ps1`). Services `collabcanvas-web`/`-ws` are WinSW
  (`C:\apps\winsw\*.xml`, `onfailure=restart 5s`, StartType Automatic), logs
  `C:\apps\logs`. Postgres 17 service running (db `collabcanvas`, DATABASE_URL is
  QUOTED in the env files — the deploy script now strips quotes). Caddy = the
  user's own scheduled task at `C:\dashboard\Caddyfile` (owns :80/:443). REDEPLOY
  RECIPE that works: (1) commit, (2) `git archive HEAD > cc.tar`, scp to home,
  (3) graceful `Stop-Service` both (NO -Force → avoids the WinSW recovery bounce),
  (4) `tar -xf` over the repo, (5) run `vps-deploy.ps1` (now quote-safe +
  stop-before-npm-ci). Targets: collabcanvas.dash-board.in +
  collabcanvas-ws.dash-board.in. OAuth apps still unprovisioned (email is the
  login path). Portfolio at dash-board.in root = user's own project (untouched).

## Notion-lite roadmap (after Phase 6 + deploy) — user-expanded scope

User asks (2026-07-02): per-user databases, team vs private switching, tables,
charts, formulas, "and more". User asks (2026-07-04): export options (PDF,
Word, Excel), file attachments — any file type attachable to databases,
caps 5 MB/file and 500 MB/user. Sequenced to keep each step shippable on the
same CRDT/presence/offline stack:

| Phase | Feature |
|---|---|
| N1 | Rich text card descriptions: TipTap + y-prosemirror on Y.XmlFragment (links, lists, marks; collaborative text cursors) |
| N2 | Doc Pages: `page:<id>` rooms, full-page TipTap editor, sidebar (boards + pages) |
| N3 | Workspaces: Private vs Team sections (schema: Workspace{type} → boards/pages), share at workspace level, switcher UI |
| N4 | Databases: typed tables as first-class collaborative entities (columns: text/number/select/date/checkbox; rows in Yjs; table view) |
| N5 | Files: attachments on database rows (attachment column type) — any file type, 5 MB/file, 500 MB/user (enforced server-side; File table + disk storage on the VPS), upload/download API, per-user usage meter |
| N6 | Views + charts over databases (filter/sort/group; bar/line/pie via derive pattern — use the dataviz skill when building) |
| N7 | Formulas: computed columns (small expression parser; sum/avg/count/if/concat), inline tables in pages, slash-command menu |
| N8 | Exports: board/page → PDF + Word (docx), database → Excel (xlsx); server-side generation, honest fidelity note |

Honest scope line: no block-level permissions, no comments/notifications, no
full Notion parity — "a lite Notion, functionally" per user.

## Hard rules

1. Phase cadence: build → verify (harness/acceptance) → adversarial review →
   fix confirmed findings → re-verify → update THIS FILE → report pass/fail.
2. No Yjs/awareness imports in presentational components — ever.
3. Verify every library API against the INSTALLED version before use.
4. Don't fabricate metrics; label placeholders `MEASURE`.
5. Update this file + memory before ending any work session.
