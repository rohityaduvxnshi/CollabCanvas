/**
 * The Yjs document model for a board (spec §3).
 *
 * One `Y.Doc` per board. Structure:
 *
 *   Y.Doc
 *   ├─ meta         : Y.Map      { title: string, updatedAt: number }
 *   ├─ columnOrder  : Y.Array<string>          ordered column ids
 *   ├─ columns      : Y.Map<colId, Y.Map>      { id, title, cardOrder: Y.Array<string> }
 *   └─ cards        : Y.Map<cardId, Y.Map>     { id, title, description, createdBy }
 *
 * Rules that keep concurrent edits conflict-free:
 *  - Order lives in arrays (`columnOrder`, per-column `cardOrder`); entities live
 *    once in the flat `columns` / `cards` maps. Moving a card only rewrites order
 *    arrays, so the card entity never conflicts on a move.
 *  - Never replace a whole Y.Array/Y.Map with a plain JS value — always mutate
 *    through `.push/.insert/.delete/.set`.
 *
 * This module is the ONLY place that knows the field names / nesting. Everything
 * else (mutations, deriveBoardView, seed) goes through these accessors.
 */

import * as Y from "yjs";

// Top-level shared-type names (single source of truth).
export const META = "meta";
export const COLUMN_ORDER = "columnOrder";
export const COLUMNS = "columns";
export const CARDS = "cards";

/** A column entity: Y.Map { id, title, cardOrder: Y.Array<string> }. */
export type YColumn = Y.Map<unknown>;
/** A card entity: Y.Map { id, title, description, createdBy }. */
export type YCard = Y.Map<unknown>;

// --- Top-level accessors ---------------------------------------------------

export const getMeta = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(META);
export const getColumnOrder = (doc: Y.Doc): Y.Array<string> =>
  doc.getArray<string>(COLUMN_ORDER);
export const getColumns = (doc: Y.Doc): Y.Map<YColumn> =>
  doc.getMap<YColumn>(COLUMNS);
export const getCards = (doc: Y.Doc): Y.Map<YCard> => doc.getMap<YCard>(CARDS);

// --- Field accessors (centralize the casts) --------------------------------

export const colTitle = (col: YColumn): string =>
  (col.get("title") as string | undefined) ?? "";
export const colCardOrder = (col: YColumn): Y.Array<string> =>
  col.get("cardOrder") as Y.Array<string>;

export const cardTitle = (card: YCard): string =>
  (card.get("title") as string | undefined) ?? "";
export const cardDescription = (card: YCard): string =>
  (card.get("description") as string | undefined) ?? "";

// --- Entity factories ------------------------------------------------------

/** Build a detached column Y.Map (with its own cardOrder Y.Array). */
export const makeColumn = (id: string, title: string): YColumn => {
  const col: YColumn = new Y.Map<unknown>();
  col.set("id", id);
  col.set("title", title);
  col.set("cardOrder", new Y.Array<string>());
  return col;
};

/** Build a detached card Y.Map. */
export const makeCard = (
  id: string,
  title: string,
  description = "",
  createdBy = "",
): YCard => {
  const card: YCard = new Y.Map<unknown>();
  card.set("id", id);
  card.set("title", title);
  card.set("description", description);
  card.set("createdBy", createdBy);
  return card;
};

/** Locate the column id whose `cardOrder` currently contains `cardId`. */
export const findColumnIdOfCard = (
  doc: Y.Doc,
  cardId: string,
): string | null => {
  const columns = getColumns(doc);
  for (const colId of getColumnOrder(doc).toArray()) {
    const col = columns.get(colId);
    if (!col) continue;
    if (colCardOrder(col).toArray().includes(cardId)) return colId;
  }
  return null;
};

/** Remove every occurrence of `value` from a Y.Array<string>. */
export const removeAllFromArray = (arr: Y.Array<string>, value: string): void => {
  // Iterate from the end so indices stay valid as we delete.
  const snapshot = arr.toArray();
  for (let i = snapshot.length - 1; i >= 0; i--) {
    if (snapshot[i] === value) arr.delete(i, 1);
  }
};
