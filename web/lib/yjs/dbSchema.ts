/**
 * The Yjs document model for a typed database (N4).
 *
 * One `Y.Doc` per database. Structure (mirrors the board model's array-order +
 * flat-entity discipline so concurrent edits stay conflict-free):
 *
 *   Y.Doc
 *   ├─ meta        : Y.Map      { title, updatedAt }
 *   ├─ columnOrder : Y.Array<colId>
 *   ├─ columns     : Y.Map<colId, Y.Map { id, name, type, options?: Y.Array<string> }>
 *   ├─ rowOrder    : Y.Array<rowId>
 *   └─ rows        : Y.Map<rowId, Y.Map<colId, cellValue>>
 *
 * cellValue is a primitive: string (text/date-ISO/select), number, or boolean
 * (checkbox). A missing cell = empty. `options` (a Y.Array of choice labels)
 * exists only on select columns.
 *
 * This module is the ONLY place that knows the field names / nesting.
 */

import * as Y from "yjs";
import { DB_COLUMN_TYPES, type DbColumnType } from "@collabcanvas/shared";

export const DB_META = "meta";
export const DB_COLUMN_ORDER = "columnOrder";
export const DB_COLUMNS = "columns";
export const DB_ROW_ORDER = "rowOrder";
export const DB_ROWS = "rows";

export type YDbColumn = Y.Map<unknown>;
export type YDbRow = Y.Map<unknown>;
export type DbCellValue = string | number | boolean;

// --- Top-level accessors ---------------------------------------------------

export const getDbMeta = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(DB_META);
export const getDbColumnOrder = (doc: Y.Doc): Y.Array<string> =>
  doc.getArray<string>(DB_COLUMN_ORDER);
export const getDbColumns = (doc: Y.Doc): Y.Map<YDbColumn> =>
  doc.getMap<YDbColumn>(DB_COLUMNS);
export const getDbRowOrder = (doc: Y.Doc): Y.Array<string> =>
  doc.getArray<string>(DB_ROW_ORDER);
export const getDbRows = (doc: Y.Doc): Y.Map<YDbRow> => doc.getMap<YDbRow>(DB_ROWS);

// --- Field accessors -------------------------------------------------------

export const colName = (col: YDbColumn): string =>
  (col.get("name") as string | undefined) ?? "";

export const colType = (col: YDbColumn): DbColumnType => {
  const t = col.get("type") as string | undefined;
  return (DB_COLUMN_TYPES as readonly string[]).includes(t ?? "")
    ? (t as DbColumnType)
    : "text";
};

/** Select choices (empty for non-select columns). */
export const colOptions = (col: YDbColumn): string[] => {
  const opts = col.get("options");
  return opts instanceof Y.Array ? (opts.toArray() as string[]) : [];
};

export const colOptionsArray = (col: YDbColumn): Y.Array<string> | null => {
  const opts = col.get("options");
  return opts instanceof Y.Array ? (opts as Y.Array<string>) : null;
};

/** N7: the expression of a formula column (empty for non-formula columns). */
export const colFormula = (col: YDbColumn): string =>
  (col.get("formula") as string | undefined) ?? "";

/** A cell's raw value (undefined = empty). */
export const cellValue = (row: YDbRow, colId: string): DbCellValue | undefined =>
  row.get(colId) as DbCellValue | undefined;

// --- Entity factories ------------------------------------------------------

/** Build a detached column Y.Map (with an options array iff it's a select). */
export const makeDbColumn = (
  id: string,
  name: string,
  type: DbColumnType,
): YDbColumn => {
  const col: YDbColumn = new Y.Map<unknown>();
  col.set("id", id);
  col.set("name", name);
  col.set("type", type);
  if (type === "select") col.set("options", new Y.Array<string>());
  if (type === "formula") col.set("formula", "");
  return col;
};

/** Build a detached, empty row Y.Map. */
export const makeDbRow = (id: string): YDbRow => {
  const row: YDbRow = new Y.Map<unknown>();
  row.set("id", id);
  return row;
};

/** Remove every occurrence of `value` from a Y.Array<string>. */
export const removeAllFromDbArray = (arr: Y.Array<string>, value: string): void => {
  const snapshot = arr.toArray();
  for (let i = snapshot.length - 1; i >= 0; i--) {
    if (snapshot[i] === value) arr.delete(i, 1);
  }
};
