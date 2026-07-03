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
  cardDescription,
  cardTitle,
  colCardOrder,
  colTitle,
  getCards,
  getColumnOrder,
  getColumns,
  getMeta,
  makeCard,
  makeColumn,
  type YCard,
  type YColumn,
} from "./schema";

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
      const live = cards.get(cardId);
      if (live) {
        if (cardTitle(live) !== cardTitle(tCard)) live.set("title", cardTitle(tCard));
        if (cardDescription(live) !== cardDescription(tCard))
          live.set("description", cardDescription(tCard));
      } else {
        const created = (tCard.get("createdBy") as string | undefined) ?? "";
        cards.set(cardId, makeCard(cardId, cardTitle(tCard), cardDescription(tCard), created));
      }
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
