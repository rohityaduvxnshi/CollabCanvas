/**
 * `deriveBoardView(doc)` — the single source of truth for rendering (spec §3).
 *
 * Pure function: reads the Yjs doc and returns the ordered, de-duplicated
 * `BoardData` the UI renders. This is the seam between Yjs and the UI — the
 * presentational components never touch Yjs, only the `BoardData` this returns.
 *
 * CRDT edge cases handled here (documented, not ignored):
 *  1. Duplicate column id in `columnOrder` (e.g. two clients seed at once):
 *     keep the FIRST occurrence, drop the rest.
 *  2. A card id in TWO columns' `cardOrder` after simultaneous moves to
 *     different columns: keep the occurrence in the earlier column (by
 *     `columnOrder`), drop the rest — deterministic on every client.
 *  3. A card id in a `cardOrder` that has no entity in the `cards` map, or a
 *     column id in `columnOrder` with no entity in `columns`: skip it.
 *  4. Orphan cards (entity present in `cards` but referenced by no `cardOrder`):
 *     intentionally NOT rendered. The entity stays in the doc; it just isn't
 *     shown. (Alternative would be an "Unsorted" bucket; we pick drop-from-view
 *     and stay consistent.)
 */

import type * as Y from "yjs";
import type { BoardData, CardView, ColumnView } from "@collabcanvas/shared";
import {
  cardDescText,
  cardFiles,
  cardTitle,
  colCardOrder,
  colFiles,
  colTitle,
  getCards,
  getColumnOrder,
  getColumns,
  getMeta,
} from "./schema";

export function deriveBoardView(doc: Y.Doc): BoardData {
  const meta = getMeta(doc);
  const title = (meta.get("title") as string | undefined) ?? "Untitled board";

  const columnOrder = getColumnOrder(doc).toArray();
  const columns = getColumns(doc);
  const cards = getCards(doc);

  const seenColumns = new Set<string>();
  const placedCards = new Set<string>(); // cross-column + intra-column dedupe
  const columnViews: ColumnView[] = [];

  for (const colId of columnOrder) {
    if (seenColumns.has(colId)) continue; // edge case 1: duplicate column id
    seenColumns.add(colId);

    const col = columns.get(colId);
    if (!col) continue; // edge case 3: order references a missing column

    const cardViews: CardView[] = [];
    for (const cardId of colCardOrder(col).toArray()) {
      if (placedCards.has(cardId)) continue; // edge case 2: dup across/within columns
      const card = cards.get(cardId);
      if (!card) continue; // edge case 3: order references a missing card
      placedCards.add(cardId);
      cardViews.push({
        id: cardId,
        title: cardTitle(card),
        // N1: plain-text preview of the rich fragment (legacy string fallback).
        description: cardDescText(card),
        files: cardFiles(card), // N9
      });
    }

    columnViews.push({
      id: colId,
      title: colTitle(col),
      cards: cardViews,
      files: colFiles(col), // N9
    });
  }

  return { title, columns: columnViews };
}
