/**
 * Shared, framework-agnostic types and tiny helpers used by both the Next.js
 * app (`/web`) and the standalone WebSocket server (`/ws-server`).
 *
 * These are intentionally plain data shapes (no Yjs, no React). They are the
 * seam between the sync layer and the UI, and between the web app and the WS
 * server. See the project spec §7 (UI contract) and §5 (auth token flow).
 */

// ---------------------------------------------------------------------------
// Board view — the shape the presentational UI renders (spec §7).
// This is derived from the Yjs document by `deriveBoardView`; the UI never
// sees Yjs types, only these.
// ---------------------------------------------------------------------------

export interface CardView {
  id: string;
  title: string;
  description: string;
}

export interface ColumnView {
  id: string;
  title: string;
  cards: CardView[];
}

export interface BoardData {
  title: string;
  columns: ColumnView[];
}

/**
 * The mutation surface the UI calls. Implemented against the Yjs doc in the
 * sync layer; the presentational components only ever receive this object and
 * call its methods (they never see Yjs). See spec §7.
 */
export interface BoardActions {
  addColumn(title: string): void;
  renameColumn(id: string, title: string): void;
  deleteColumn(id: string): void;
  addCard(columnId: string, title: string): void;
  updateCard(
    cardId: string,
    patch: Partial<Pick<CardView, "title" | "description">>,
  ): void;
  deleteCard(cardId: string): void;
  moveCard(cardId: string, toColumnId: string, toIndex: number): void;
  moveColumn(columnId: string, toIndex: number): void;
}

// ---------------------------------------------------------------------------
// Roles & connection status
// ---------------------------------------------------------------------------

export type Role = "editor" | "viewer";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "offline";

// ---------------------------------------------------------------------------
// Presence / awareness (spec §7)
// ---------------------------------------------------------------------------

/** A remote peer's presence, as consumed by the UI. */
export interface PeerPresence {
  /**
   * The awareness client id — unique per connected doc instance and the ONLY
   * safe React key. `userId` is NOT unique across peers: a duplicated browser
   * tab copies sessionStorage (same guest id), and Phase 4's real users can
   * open the board in several tabs at once.
   */
  clientId: number;
  userId: string;
  name: string;
  color: string;
  image?: string;
  cursor: { x: number; y: number } | null;
  editingCardId: string | null;
}

/** The local awareness state each client publishes over the awareness protocol. */
export interface AwarenessState {
  user: {
    id: string;
    name: string;
    color: string;
    image?: string;
  };
  cursor: { x: number; y: number } | null;
  editingCardId: string | null;
}

// ---------------------------------------------------------------------------
// Cross-service auth (spec §5): the short-lived JWT the web app mints and the
// WS server verifies. `iat`/`exp` are added by the signer.
// ---------------------------------------------------------------------------

export interface WsTokenClaims {
  /** User id (JWT subject). */
  sub: string;
  /** Board id — the room the token grants access to. */
  room: string;
  role: Role;
  name: string;
  image?: string;
}

// ---------------------------------------------------------------------------
// Room naming — one Yjs room per board. Shared so the web client and the WS
// server agree on the exact room string.
// ---------------------------------------------------------------------------

export const roomForBoard = (boardId: string): string => `board:${boardId}`;

// ---------------------------------------------------------------------------
// Entity limits (Phase 6) — enforced by the client mutations (clamped/no-op)
// and by the web API where input crosses the wire. Honest caveat: the WS
// server does NOT decode CRDT updates to re-validate these (v1 limitation,
// documented in the README) — a tampered client could exceed them.
// ---------------------------------------------------------------------------

export const LIMITS = {
  boardTitle: 120,
  columnTitle: 120,
  cardTitle: 300,
  cardDescription: 5000,
  columnsPerBoard: 50,
  cardsPerBoard: 500,
  historyLabel: 120,
} as const;
