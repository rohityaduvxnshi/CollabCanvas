/**
 * Restore a board doc from a history snapshot (Phase 5).
 *
 * You can't "apply" an old snapshot to roll back a CRDT — applying old updates
 * just merges them in (they're already part of the state). A restore is a HARD
 * RESET performed as one transaction of ordinary mutations.
 *
 * CRITICAL: the rebuild happens IN PLACE. Existing column/card Y.Map instances
 * are reused (fields set, order arrays cleared and refilled) rather than
 * replaced with fresh instances. Replacing instances would tombstone the old
 * subtrees, so any edit made CONCURRENTLY with the restore (an offline peer's
 * whole session, or someone racing the restore by milliseconds) would merge
 * into deleted maps and silently vanish. With in-place rebuilds those edits
 * land on live objects: a concurrently added card stays visible, a concurrent
 * title edit survives as a normal LWW merge.
 */

import * as Y from "yjs";
import {
  CARD_DESC,
  cardDescFragment,
  cardDescription,
  cardTitle,
  colCardOrder,
  colTitle,
  FILES,
  getCards,
  getColumnOrder,
  getColumns,
  getMeta,
  makeCard,
  makeColumn,
  type YCard,
  type YColumn,
} from "./schema";

/** Restore a card/column's N9 `files` JSON string to the snapshot's value
 *  (in place, like every other field), or clear it if the snapshot had none —
 *  otherwise a restore silently keeps the LIVE attachments (data mismatch). */
function restoreFiles(live: Y.Map<unknown>, snapshot: Y.Map<unknown>): void {
  const f = snapshot.get(FILES);
  if (typeof f === "string") live.set(FILES, f);
  else live.delete(FILES);
}

/**
 * N1: restore a card's rich-description fragment IN PLACE — the live
 * Y.XmlFragment instance survives (same principle as the card maps: replacing
 * it would tombstone the subtree and any concurrent typing would vanish into
 * a deleted fragment). Content is cleared and refilled with clones from the
 * snapshot; toString() (which includes formatting tags) is the change check.
 */
function restoreDescFragment(live: YCard, snapshotCard: YCard): void {
  const snapFrag = cardDescFragment(snapshotCard);
  const liveFrag = cardDescFragment(live);
  if (!snapFrag) {
    // Snapshot predates rich text — empty the live fragment so the legacy
    // string (restored above) is what cardDescText falls back to.
    if (liveFrag && liveFrag.length > 0) liveFrag.delete(0, liveFrag.length);
    return;
  }
  if (liveFrag && liveFrag.toString() === snapFrag.toString()) return;
  let target = liveFrag;
  if (!target) {
    target = new Y.XmlFragment();
    live.set(CARD_DESC, target);
  } else if (target.length > 0) {
    target.delete(0, target.length);
  }
  target.insert(
    0,
    snapFrag.toArray().map((n) => n.clone()) as (Y.XmlElement | Y.XmlText)[],
  );
}

export function replaceDocFromSnapshot(doc: Y.Doc, snapshot: Uint8Array): void {
  const temp = new Y.Doc();
  Y.applyUpdate(temp, snapshot);

  const meta = getMeta(doc);
  const columnOrder = getColumnOrder(doc);
  const columns = getColumns(doc);
  const cards = getCards(doc);

  const tempColumns = getColumns(temp);
  const tempCards = getCards(temp);
  const tempTitle = getMeta(temp).get("title") as string | undefined;

  doc.transact(() => {
    if (tempTitle) meta.set("title", tempTitle);

    // --- Cards: update in place / create missing / delete absent -----------
    for (const [cardId, raw] of tempCards.entries()) {
      const tCard = raw as YCard;
      let live = cards.get(cardId);
      if (live) {
        if (cardTitle(live) !== cardTitle(tCard)) live.set("title", cardTitle(tCard));
        if (cardDescription(live) !== cardDescription(tCard))
          live.set("description", cardDescription(tCard));
      } else {
        const created = (tCard.get("createdBy") as string | undefined) ?? "";
        cards.set(cardId, makeCard(cardId, cardTitle(tCard), cardDescription(tCard), created));
        live = cards.get(cardId)!;
      }
      restoreDescFragment(live, tCard);
      restoreFiles(live, tCard); // N9
    }
    for (const cardId of Array.from(cards.keys())) {
      if (!tempCards.has(cardId)) cards.delete(cardId);
    }

    // --- Columns: same in-place strategy ------------------------------------
    for (const [colId, raw] of tempColumns.entries()) {
      const tCol = raw as YColumn;
      let live = columns.get(colId);
      if (live) {
        if (colTitle(live) !== colTitle(tCol)) live.set("title", colTitle(tCol));
        const order = colCardOrder(live);
        order.delete(0, order.length); // clear IN PLACE — array instance survives
      } else {
        columns.set(colId, makeColumn(colId, colTitle(tCol)));
        live = columns.get(colId)!;
      }
      const order = colCardOrder(live);
      for (const cardId of colCardOrder(tCol).toArray()) {
        if (tempCards.has(cardId)) order.push([cardId]);
      }
      restoreFiles(live, tCol); // N9
    }
    for (const colId of Array.from(columns.keys())) {
      if (!tempColumns.has(colId)) columns.delete(colId);
    }

    // --- Column order: clear in place, refill from the snapshot ------------
    columnOrder.delete(0, columnOrder.length);
    for (const colId of getColumnOrder(temp).toArray()) {
      if (tempColumns.has(colId)) columnOrder.push([colId]);
    }

    meta.set("updatedAt", Date.now());
  });

  temp.destroy();
}
