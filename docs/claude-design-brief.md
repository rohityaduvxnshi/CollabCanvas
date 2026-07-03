# CollabCanvas — Frontend Design Brief (for Claude Design)

> **STATUS: implemented.** The delivered design (`CollabCanvas.dc.html` in the
> Claude Design project) is now ported into `web/components/**` + `globals.css`
> (tokens, light/dark via `data-cc-theme` on `<html>`, Fredoka/Space
> Grotesk/Space Mono via `next/font`). Deviations from the mock, on purpose:
> the dashboard, ShareDialog, and Share button shipped with Phase 4 (wired to
> real auth/membership); the History panel ships with Phase 5; card
> labels/due/assignee are prototype-only fields not in the data model (cards
> show title + description); add-column lives as the trailing board affordance
> instead of a toolbar button; the demo panel is prototype-only.

> **Purpose of this document.** The sync engine (Yjs CRDT, WebSocket provider,
> presence, auth) for CollabCanvas is already built and tested. This brief hands
> the **visual layer** to Claude Design to **regenerate from scratch** — new
> look, new markup, new styling — while keeping the app fully functional.
>
> You are rebuilding *presentation only*. You consume a small, stable **hook
> contract** and render. If you follow the one hard rule below, the app keeps
> working end-to-end (real-time multiplayer sync, offline merge, presence, roles)
> without you touching a line of sync code.

---

## 0. The one hard rule

**Presentational components must contain ZERO sync imports.** No `yjs`, no
`y-websocket`, no `y-protocols`/awareness, no provider internals, no
`@collabcanvas/shared` *runtime* values beyond the plain types. Components
receive **plain data + callbacks as props** (or read the documented hooks) and
render. That's the entire seam.

If you find yourself importing anything from `web/lib/yjs/**`,
`web/lib/board/BoardRoomProvider`, `web/lib/board/boardStore`, or `ws-server/**`
inside a visual component — stop; you've crossed the boundary.

You **may** use `@dnd-kit/*` in the board components (drag is a UI concern, not
sync) — see §4.

---

## 1. What the app is

A live, multiplayer Trello: multiple authenticated users edit the same kanban
board simultaneously. Edits sync in real time and merge without conflicts;
users see each other's live cursors and "who's editing what"; offline edits
merge on reconnect; access is role-based (editor vs viewer).

Three services (you only touch the first, and only its visual components):

- **`web/`** — Next.js 16 (App Router) + React 19 + Tailwind v4. ← your work
- `ws-server/` — standalone WebSocket sync server. Do not touch.
- `packages/shared/` — plain TS types shared by both. Types only.

---

## 2. The UI contract (the seam)

These are the **only** things a visual component needs. Import the types from
`@collabcanvas/shared`; call the hooks from `web/lib/board`.

### 2.1 Data types

```ts
interface CardView   { id: string; title: string; description: string }
interface ColumnView { id: string; title: string; cards: CardView[] }
interface BoardData  { title: string; columns: ColumnView[] }

interface BoardActions {
  addColumn(title: string): void
  renameColumn(id: string, title: string): void
  deleteColumn(id: string): void
  addCard(columnId: string, title: string): void
  updateCard(cardId: string, patch: Partial<Pick<CardView, "title" | "description">>): void
  deleteCard(cardId: string): void
  moveCard(cardId: string, toColumnId: string, toIndex: number): void
  moveColumn(columnId: string, toIndex: number): void
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "offline"

interface PeerPresence {
  userId: string; name: string; color: string; image?: string
  cursor: { x: number; y: number } | null
  editingCardId: string | null
}
```

### 2.2 Hooks (already implemented — do not reimplement)

```ts
// web/lib/board/useBoard.ts
function useBoard(boardId: string): {
  data: BoardData
  actions: BoardActions
  status: ConnectionStatus
  canEdit: boolean            // false for viewers → disable all mutation UI
}

// web/lib/board/usePresence.ts    (implemented — Phase 2)
function usePresence(): {
  peers: PeerPresence[]
  setCursor(x: number, y: number): void   // throttled INTERNALLY to ~20/s — call freely per pointermove
  clearCursor(): void                     // hide the local cursor (pointer left the board)
  setEditing(cardId: string | null): void
}
```

**Rule of thumb:** the *container* (`BoardScreen`) calls the hooks and passes
`data` / `actions` / presence down as props. The leaf visual components
(`Board`, `Column`, `Card`, …) stay pure and prop-driven so they're trivially
restyleable. You may keep this split or fold hook usage into a top-level client
component — just keep the leaves pure.

---

## 3. Components to (re)build

Everything under `web/components/**` is yours to redesign. Keep the **prop
shapes** (or the hook usage) so the wiring holds; change everything visual.

### Exists today (Phases 1–2)

| Component | Props | Role |
|---|---|---|
| `BoardScreen` | `{ boardId: string }` | Container: calls `useBoard` + `usePresence`, owns the `@dnd-kit` `DndContext`, the board **scroll container**, pointer tracking, and the cursor overlay layer; renders `Toolbar` + `Board` + `Cursor`s. |
| `Board` | `{ data, canEdit, actions, getCardEditing?, onCardEditFocus?, onCardEditBlur? }` | Horizontal, sortable row of columns. **Does not scroll itself** — it sizes to content (`w-max min-w-full`); the container scrolls. |
| `Column` | `{ column, canEdit, onAddCard, onRenameColumn, onDeleteColumn, onUpdateCard, onDeleteCard, getCardEditing?, onCardEditFocus?, onCardEditBlur? }` | One column: header (editable title, count, delete), sortable card list, add-card. |
| `Card` | `{ card, columnId, canEdit, onUpdate, onDelete, editingBy?, onEditFocus?, onEditBlur? }` | One card: title + description, inline edit, delete, "someone is editing" badge. |
| `AddCardInput` | `{ onAdd, canEdit }` | Inline "add a card" affordance. |
| `Toolbar` | `{ title, canEdit, status, onAddColumn, right? }` | Board title, connection pill, "view only" tag, add-column, `right` slot (presence). |
| `ConnectionPill` | `{ status: ConnectionStatus }` | Small status indicator. |

`editingBy` / `getCardEditing` return `{ name: string; color: string } | null`
(presence; wired in Phase 2).

| `Cursor` | `{ name: string; color: string; x: number; y: number }` | A remote peer's live cursor (name label + colored pointer). Rendered inside the scrolled content wrapper, positioned in board-**content** coordinates (`x`/`y` are relative to the content element, so cursors stay glued to cards regardless of each user's scroll offset). |
| `PresenceBar` | `{ peers: PeerPresence[] }` | Stack of avatars/initials for who's on the board; sits in `Toolbar`'s `right` slot. |

**Cursor-tracking wiring to preserve:** the container computes coords as
`clientX - contentRect.left` against the scrolled content element
(`contentRef.getBoundingClientRect()`), calls `setCursor` on every
`pointermove` (throttling is internal), and `clearCursor()` on `pointerleave`.

### Planned (build the visual now against these shapes; data arrives Phase 4/5)

| Component | Props | Role |
|---|---|---|
| `ShareDialog` | `{ open, onClose, onShare(email, role: "editor"\|"viewer"), members: {name,email,role}[] }` | Add a user to the board by email with a role. |
| `HistoryPanel` | `{ open, onClose, versions: {id,label?,createdAt}[], onSave(label?), onRestore(id) }` | List of saved snapshots; save/restore (restore shows a hard-reset confirm). |
| `BoardList` | `{ boards: {id,title,role}[], onCreate(title), onOpen(id) }` | Dashboard list of the user's boards. |

---

## 4. Drag & drop (must preserve behavior)

The board uses **`@dnd-kit`**. This is UI, so it lives in the visual layer — but
its outcome must call the board actions:

- `Card` and `Column` use `useSortable` (from `@dnd-kit/sortable`).
- `BoardScreen` owns `DndContext` + sensors and, on drop, computes the
  destination and calls **`actions.moveCard(cardId, toColumnId, toIndex)`** or
  **`actions.moveColumn(columnId, toIndex)`**.
- `toIndex` is the index **among the other cards** in the destination column
  (i.e. after the dragged card is conceptually removed). The current
  `handleDragEnd` in `BoardScreen.tsx` shows the exact computation — keep that
  logic; restyle the drag overlay / drop affordances freely.

You may change the drag *feel* (overlay, placeholders, animations) but the
final committed action must stay `moveCard` / `moveColumn`.

---

## 5. States you must design for

The board is multiplayer and networked, so cover these explicitly:

1. **Connecting** — before first sync (`status === "connecting"`). Provider shows
   a "Connecting…" gate; you can restyle it.
2. **Live / connected** — normal editing.
3. **Disconnected / Offline** — `status` is `"disconnected"` or `"offline"`;
   surface it (pill) but keep the board usable (offline edits queue and merge).
4. **Viewer (read-only)** — `canEdit === false`: hide/disable every mutation
   affordance (no add, edit, delete, or drag); show a "View only" indication.
5. **Empty board** — no columns yet: inviting empty state + a clear "add column".
6. **Presence** — remote cursors moving, avatars in the bar, "editing" badges on
   cards. Design for 1–8 concurrent peers; degrade gracefully beyond that.

---

## 6. Boundaries — what you may and may not change

**May change (yours):**
- `web/components/**` — all visual components.
- `web/app/**` page/layout **markup and styling** (keep the data flow: the board
  page renders `<BoardRoomProvider boardId=...>` wrapping the board container).
- `web/app/globals.css`, Tailwind theme, fonts, colors, spacing.

**Must NOT change (sync layer — keep intact):**
- `web/lib/yjs/**` (doc model, mutations, `deriveBoardView`, seed).
- `web/lib/board/BoardRoomProvider.tsx`, `boardStore.ts`, `useBoard.ts`,
  `usePresence.ts`, `config.ts`.
- `ws-server/**`, `packages/shared/**` (types you import, but don't edit).

If a redesign genuinely needs a new piece of data, **add a field to the hook
return / component props via the contract** and note it — don't reach into Yjs.

---

## 7. Design direction

Aesthetic is open — make it distinctive, not a Trello clone screenshot. Guardrails:

- **Legible, dense, calm.** It's a work tool; information density matters, but
  keep generous hit targets for drag. Cards are the hero; columns frame them.
- **Motion with purpose.** Drag feedback, presence cursors, and status changes
  are the moments that show it's *live* — make those feel good; don't over-animate
  static content.
- **Presence is a feature, not decoration.** Cursors, avatars, and editing
  badges should read instantly and never obscure content.
- **Accessible.** Keyboard-operable drag (dnd-kit's keyboard sensor is wired),
  visible focus, sufficient contrast, `aria` labels on icon buttons.
- **Responsive.** Columns scroll horizontally; works down to a tablet width.
- **Tailwind v4** (CSS-first theme in `globals.css`). Dark mode welcome.

---

## 8. Definition of done

- Every component above renders from the contract; no visual component imports
  anything from the sync layer (§0).
- All callbacks are wired: add/rename/delete column, add/update/delete card,
  move card, move column, and (when present) share / history / presence.
- `npm run typecheck` and `npm run lint` pass in `web/`.
- The five+ states in §5 are visibly handled.
- Two browser windows on the same board still sync in real time, drag still
  moves cards, viewers still can't edit — i.e. you changed the looks, not the
  behavior.
