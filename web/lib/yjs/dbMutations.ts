/**
 * Database mutations (N4) — the concrete `DbActions` against a Yjs doc. Every
 * multi-step change runs in one `doc.transact` (atomic, one update). Same
 * array-order + flat-entity discipline as the board; caps clamped here (the
 * ws-server doesn't decode CRDT to re-validate — documented v1 caveat).
 */

import * as Y from "yjs";
import {
  DB_COLUMN_TYPES,
  LIMITS,
  type DbActions,
  type DbColumnType,
} from "@collabcanvas/shared";
import { newId } from "./ids";
import {
  cellValue,
  colOptionsArray,
  colType,
  getDbColumnOrder,
  getDbColumns,
  getDbRowOrder,
  getDbRows,
  makeDbColumn,
  makeDbRow,
  removeAllFromDbArray,
} from "./dbSchema";

const clampIndex = (index: number, length: number): number =>
  Math.max(0, Math.min(index, length));

const isType = (t: string): t is DbColumnType =>
  (DB_COLUMN_TYPES as readonly string[]).includes(t);

/** Coerce an incoming cell value to the column's type (or undefined = clear). */
function coerceCell(
  type: DbColumnType,
  value: string | number | boolean | null,
): string | number | boolean | undefined {
  if (value === null || value === "") return undefined;
  switch (type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case "checkbox":
      return value === true || value === "true";
    case "attachment":
      // JSON id-list; longer than a text cell, bounded by attachmentsPerCell
      // in the UI (the ws-server doesn't decode CRDT — documented caveat).
      return String(value).slice(0, 10_000);
    case "text":
    case "select":
    case "date":
    default:
      return String(value).slice(0, LIMITS.dbCellText);
  }
}

export function createDbActions(doc: Y.Doc): DbActions {
  const columnOrder = getDbColumnOrder(doc);
  const columns = getDbColumns(doc);
  const rowOrder = getDbRowOrder(doc);
  const rows = getDbRows(doc);
  const touch = () => doc.getMap("meta").set("updatedAt", Date.now());

  return {
    setTitle(title) {
      doc.transact(() => {
        doc.getMap("meta").set("title", title.slice(0, LIMITS.dbColumnName));
        touch();
      });
    },

    addColumn(name, type) {
      doc.transact(() => {
        if (columns.size >= LIMITS.dbColumns) return;
        const t = isType(type) ? type : "text";
        const id = newId();
        columns.set(
          id,
          makeDbColumn(id, name.trim().slice(0, LIMITS.dbColumnName) || "Column", t),
        );
        columnOrder.push([id]);
        touch();
      });
    },

    renameColumn(colId, name) {
      doc.transact(() => {
        const col = columns.get(colId);
        if (col) col.set("name", name.slice(0, LIMITS.dbColumnName));
        touch();
      });
    },

    changeColumnType(colId, type) {
      doc.transact(() => {
        const col = columns.get(colId);
        if (!col || !isType(type)) return;
        col.set("type", type);
        // Ensure a select column always has an options array; leave existing.
        if (type === "select" && !colOptionsArray(col)) {
          col.set("options", new Y.Array<string>());
        }
        // Ensure a formula column always has a formula field.
        if (type === "formula" && col.get("formula") === undefined) {
          col.set("formula", "");
        }
        touch();
      });
    },

    setColumnFormula(colId, formula) {
      doc.transact(() => {
        const col = columns.get(colId);
        if (col) col.set("formula", formula.slice(0, LIMITS.dbCellText));
        touch();
      });
    },

    setSelectOptions(colId, options) {
      doc.transact(() => {
        const col = columns.get(colId);
        if (!col) return;
        let arr = colOptionsArray(col);
        if (!arr) {
          arr = new Y.Array<string>();
          col.set("options", arr);
        }
        arr.delete(0, arr.length); // replace in place — instance survives
        // Dedupe: duplicate labels make duplicate <option> React keys, and
        // Y.Array's insert-union merge can otherwise accumulate dupes.
        const deduped = [
          ...new Set(
            options.map((o) => o.trim().slice(0, LIMITS.dbColumnName)).filter(Boolean),
          ),
        ].slice(0, LIMITS.dbSelectOptions);
        arr.push(deduped);
        touch();
      });
    },

    deleteColumn(colId) {
      doc.transact(() => {
        columns.delete(colId);
        removeAllFromDbArray(columnOrder, colId);
        // Drop the cell in every row so orphan cells don't linger.
        for (const row of rows.values()) if (row.has(colId)) row.delete(colId);
        touch();
      });
    },

    moveColumn(colId, toIndex) {
      doc.transact(() => {
        if (!columnOrder.toArray().includes(colId)) return;
        removeAllFromDbArray(columnOrder, colId);
        columnOrder.insert(clampIndex(toIndex, columnOrder.length), [colId]);
        touch();
      });
    },

    addRow() {
      doc.transact(() => {
        if (rowOrder.length >= LIMITS.dbRows) return;
        const id = newId();
        rows.set(id, makeDbRow(id));
        rowOrder.push([id]);
        touch();
      });
    },

    deleteRow(rowId) {
      doc.transact(() => {
        rows.delete(rowId);
        removeAllFromDbArray(rowOrder, rowId);
        touch();
      });
    },

    moveRow(rowId, toIndex) {
      doc.transact(() => {
        if (!rowOrder.toArray().includes(rowId)) return;
        removeAllFromDbArray(rowOrder, rowId);
        rowOrder.insert(clampIndex(toIndex, rowOrder.length), [rowId]);
        touch();
      });
    },

    setCell(rowId, colId, value) {
      doc.transact(() => {
        const row = rows.get(rowId);
        const col = columns.get(colId);
        if (!row || !col) return;
        if (colType(col) === "formula") return; // computed, never stored
        const coerced = coerceCell(colType(col), value);
        if (coerced === undefined) {
          if (row.has(colId)) row.delete(colId);
        } else if (cellValue(row, colId) !== coerced) {
          row.set(colId, coerced);
        }
        touch();
      });
    },
  };
}
