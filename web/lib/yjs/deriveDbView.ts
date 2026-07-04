/**
 * `deriveDbView(doc)` — single render source for a typed database (N4; N7 adds
 * computed formula columns). Pure: reads the Yjs doc, returns ordered,
 * de-duplicated `DbView` with formula cells evaluated per row (references
 * resolved by column NAME; cycles yield "#ERR: cycle", never an infinite loop).
 */

import type * as Y from "yjs";
import type { DbCellValue } from "./dbSchema";
import type { DbColumnView, DbRowView, DbView } from "@collabcanvas/shared";
import {
  cellValue,
  colFormula,
  colName,
  colOptions,
  colType,
  getDbColumnOrder,
  getDbColumns,
  getDbMeta,
  getDbRowOrder,
  getDbRows,
} from "./dbSchema";
import { evalFormula, type FormulaValue } from "../db/formula";

export function deriveDbView(doc: Y.Doc): DbView {
  const meta = getDbMeta(doc);
  const title = (meta.get("title") as string | undefined) ?? "Untitled database";

  const columns = getDbColumns(doc);
  const rows = getDbRows(doc);

  const seenCols = new Set<string>();
  const columnViews: DbColumnView[] = [];
  for (const colId of getDbColumnOrder(doc).toArray()) {
    if (seenCols.has(colId)) continue;
    seenCols.add(colId);
    const col = columns.get(colId);
    if (!col) continue;
    const type = colType(col);
    columnViews.push({
      id: colId,
      name: colName(col),
      type,
      options: colOptions(col),
      ...(type === "formula" ? { formula: colFormula(col) } : {}),
    });
  }

  const seenRows = new Set<string>();
  const rowViews: DbRowView[] = [];
  for (const rowId of getDbRowOrder(doc).toArray()) {
    if (seenRows.has(rowId)) continue;
    seenRows.add(rowId);
    const row = rows.get(rowId);
    if (!row) continue;

    // Raw (stored) values for non-formula columns.
    const cells: Record<string, DbCellValue> = {};
    for (const c of columnViews) {
      if (c.type === "formula") continue;
      const v = cellValue(row, c.id);
      if (v !== undefined) cells[c.id] = v;
    }

    // Compute formula columns on demand, memoized, with cycle detection.
    const memo = new Map<string, FormulaValue>();
    const computing = new Set<string>();
    const valueOf = (c: DbColumnView): FormulaValue | undefined => {
      if (c.type !== "formula") return cells[c.id];
      if (memo.has(c.id)) return memo.get(c.id);
      if (computing.has(c.id)) return "#ERR: cycle";
      computing.add(c.id);
      const result: FormulaValue = c.formula
        ? evalFormula(c.formula, (name) => {
            const target = columnViews.find((x) => x.name === name);
            return target ? valueOf(target) : undefined;
          })
        : "";
      computing.delete(c.id);
      memo.set(c.id, result);
      return result;
    };

    for (const c of columnViews) {
      if (c.type !== "formula") continue;
      const v = valueOf(c);
      if (v !== undefined && v !== "") cells[c.id] = v;
    }

    rowViews.push({ id: rowId, cells });
  }

  return { title, columns: columnViews, rows: rowViews };
}
