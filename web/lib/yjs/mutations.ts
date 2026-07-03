/**
 * Board mutations — the concrete `BoardActions` (spec §7) implemented against a
 * Yjs doc. Every multi-step mutation runs inside a single `doc.transact(...)`
 * so it is atomic and produces one update (spec §3, rule 2).
 *
 * This is sync logic, not UI: it lives here (not in components) so the
 * presentational layer stays Yjs-free and swappable.
 */

import * as Y from "yjs";
import { LIMITS, type BoardActions } from "@collabcanvas/shared";
import { newId } from "./ids";
import {
  colCardOrder,
  findColumnIdOfCard,
  getCards,
  getColumnOrder,
  getColumns,
  makeCard,
  makeColumn,
  removeAllFromArray,
  type YColumn,
} from "./schema";

/** Clamp an insertion index into `[0, length]`. */
const clampIndex = (index: number, length: number): number =>
  Math.max(0, Math.min(index, length));

/**
 * Cards the user can actually SEE (referenced by some column's cardOrder).
 * The cap must count these, not `cards.size`: deleteColumn intentionally
 * leaves card entities behind as invisible orphans (concurrent-move safety),
 * and counting orphans would let deleted columns eat the card budget forever.
 */
function visibleCardCount(columns: Y.Map<YColumn>): number {
  let count = 0;
  for (const col of columns.values()) count += colCardOrder(col).length;
  return count;
}

export function createBoardActions(
  doc: Y.Doc,
  opts: { createdBy?: string } = {},
): BoardActions {
  const createdBy = opts.createdBy ?? "";
  const columnOrder = getColumnOrder(doc);
  const columns = getColumns(doc);
  const cards = getCards(doc);

  const touch = () => doc.getMap("meta").set("updatedAt", Date.now());

  return {
    addColumn(title) {
      doc.transact(() => {
        if (columns.size >= LIMITS.columnsPerBoard) return; // cap (Phase 6)
        const id = newId();
        columns.set(
          id,
          makeColumn(id, title.trim().slice(0, LIMITS.columnTitle) || "New column"),
        );
        columnOrder.push([id]);
        touch();
      });
    },

    renameColumn(id, title) {
      doc.transact(() => {
        const col = columns.get(id);
        if (col) col.set("title", title.slice(0, LIMITS.columnTitle));
        touch();
      });
    },

    deleteColumn(id) {
      doc.transact(() => {
        // We intentionally do NOT hard-delete the column's card ENTITIES here.
        // moveCard only rewrites order arrays (the card entity is never touched),
        // so if another client concurrently moved a card OUT of this column, an
        // entity delete would win on merge and that card would be lost from the
        // column it now lives in. Instead we drop only the column and its
        // ordering. Any card left referenced by no cardOrder becomes an orphan
        // and is dropped from the rendered view by deriveBoardView (edge case 4);
        // a background sweep can reclaim orphan entities later (Phase 6).
        columns.delete(id);
        removeAllFromArray(columnOrder, id);
        touch();
      });
    },

    addCard(columnId, title) {
      doc.transact(() => {
        const col = columns.get(columnId);
        if (!col) return;
        if (visibleCardCount(columns) >= LIMITS.cardsPerBoard) return; // cap (Phase 6)
        const id = newId();
        cards.set(
          id,
          makeCard(id, title.trim().slice(0, LIMITS.cardTitle) || "New card", "", createdBy),
        );
        colCardOrder(col).push([id]);
        touch();
      });
    },

    updateCard(cardId, patch) {
      doc.transact(() => {
        const card = cards.get(cardId);
        if (!card) return;
        if (patch.title !== undefined)
          card.set("title", patch.title.slice(0, LIMITS.cardTitle));
        if (patch.description !== undefined)
          card.set("description", patch.description.slice(0, LIMITS.cardDescription));
        touch();
      });
    },

    deleteCard(cardId) {
      doc.transact(() => {
        const colId = findColumnIdOfCard(doc, cardId);
        if (colId) {
          const col = columns.get(colId);
          if (col) removeAllFromArray(colCardOrder(col), cardId);
        }
        cards.delete(cardId);
        touch();
      });
    },

    /**
     * Move a card to `toColumnId` at `toIndex`. In one transaction: remove the
     * id from its source column's `cardOrder`, then insert it into the target
     * column's `cardOrder`. `toIndex` is interpreted against the target order
     * AFTER removal (i.e. the index among the other cards) — see BoardScreen.
     */
    moveCard(cardId, toColumnId, toIndex) {
      doc.transact(() => {
        const toCol = columns.get(toColumnId);
        if (!toCol) return;

        const fromColId = findColumnIdOfCard(doc, cardId);
        if (fromColId) {
          const fromCol = columns.get(fromColId);
          if (fromCol) removeAllFromArray(colCardOrder(fromCol), cardId);
        }

        const toOrder = colCardOrder(toCol);
        toOrder.insert(clampIndex(toIndex, toOrder.length), [cardId]);
        touch();
      });
    },

    moveColumn(columnId, toIndex) {
      doc.transact(() => {
        if (!columnOrder.toArray().includes(columnId)) return;
        // Remove ALL occurrences (concurrent restores can duplicate an id in
        // columnOrder; a single-delete move would then silently no-op) — same
        // self-healing approach moveCard uses.
        removeAllFromArray(columnOrder, columnId);
        columnOrder.insert(clampIndex(toIndex, columnOrder.length), [columnId]);
        touch();
      });
    },
  };
}
