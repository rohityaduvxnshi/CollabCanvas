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
import type { FileRef } from "@collabcanvas/shared";

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

// --- Rich descriptions (N1) -------------------------------------------------
// Cards gain a `desc` Y.XmlFragment edited by TipTap via y-sync. The legacy
// `description` string remains for cards that predate N1; on first rich edit
// the string is migrated into the fragment and cleared (the fragment becomes
// the single source of truth).

export const CARD_DESC = "desc";

export const cardDescFragment = (card: YCard): Y.XmlFragment | null => {
  const frag = card.get(CARD_DESC);
  return frag instanceof Y.XmlFragment ? frag : null;
};

/** Plain text of one XML node — formatting dropped, blocks joined with \n. */
const nodeText = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): string => {
  if (node instanceof Y.XmlText) {
    // toString() would include formatting tags (<bold>…) — use the delta.
    return (node.toDelta() as { insert?: unknown }[])
      .map((op) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  }
  if (node instanceof Y.XmlElement) {
    const children = node.toArray();
    const inline = children.some((c) => c instanceof Y.XmlText);
    return children.map(nodeText).join(inline ? "" : "\n");
  }
  return "";
};

/** Plain-text preview of a rich description fragment. */
export const fragmentToText = (frag: Y.XmlFragment): string =>
  frag
    .toArray()
    .map(nodeText)
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

// The card FACE shows only a couple of lines. Cap the preview so a card whose
// rich description grew large doesn't produce a huge string on every re-derive
// (deriveBoardView runs on every doc update — each remote keystroke).
// ponytail: caps the derived string, not the walk itself; realistic
// descriptions are small, so the walk cost is a non-issue — revisit only if
// pathologically large descriptions ever show up.
const PREVIEW_MAX = 280;

/** Preview text for a card: rich fragment when it has content, else legacy. */
export const cardDescText = (card: YCard): string => {
  const frag = cardDescFragment(card);
  if (frag) {
    const text = fragmentToText(frag);
    if (text) return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text;
  }
  return cardDescription(card);
};

/**
 * Get-or-create the rich description fragment, migrating the legacy string
 * into it (as paragraphs) exactly once.
 *
 * ponytail: two clients calling this concurrently on a never-migrated card
 * race on `card.set(CARD_DESC, …)` — LWW keeps one fragment and both seeds
 * held the same legacy text, so nothing user-typed is lost beyond the
 * sub-second window. Not worth a coordination protocol.
 */
export const ensureCardDescFragment = (doc: Y.Doc, card: YCard): Y.XmlFragment => {
  const existing = cardDescFragment(card);
  if (existing) return existing;
  const frag = new Y.XmlFragment();
  doc.transact(() => {
    card.set(CARD_DESC, frag);
    const legacy = cardDescription(card);
    if (legacy) {
      frag.insert(
        0,
        legacy.split("\n").map((line) => {
          const p = new Y.XmlElement("paragraph");
          if (line) p.insert(0, [new Y.XmlText(line)]);
          return p;
        }),
      );
      card.set("description", ""); // the fragment is the source of truth now
    }
  });
  return frag;
};

// --- File attachments (N9) -------------------------------------------------
// Cards AND columns carry a `files` field: a JSON string of FileRef[] (name +
// size denormalized so deriveBoardView renders chips without a DB hit; the
// bytes + access control live server-side in the Attachment table).
//
// ponytail: LWW on the whole list — two clients attaching to the SAME card in
// the same sub-second window can drop one entry. Acceptable for a low-frequency
// action (same tradeoff as the N5 db-cell attachment JSON); a nested Y.Array
// would merge concurrent adds if it ever matters.
export const FILES = "files";

const parseFiles = (raw: unknown): FileRef[] => {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (f): f is FileRef =>
        !!f &&
        typeof (f as FileRef).id === "string" &&
        typeof (f as FileRef).name === "string" &&
        typeof (f as FileRef).size === "number",
    );
  } catch {
    return [];
  }
};

/** Files attached to a card (N9). */
export const cardFiles = (card: YCard): FileRef[] => parseFiles(card.get(FILES));
/** Files attached to a column (N9). */
export const colFiles = (col: YColumn): FileRef[] => parseFiles(col.get(FILES));

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
