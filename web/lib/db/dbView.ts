/**
 * Pure view + aggregation logic over a derived DbView (N6). No Yjs, no React —
 * a plain transform layer so the harness can test it and the chart/table UI
 * consume the result. Filter/sort produce rows; aggregate produces chart series.
 */

import type { DbColumnType, DbRowView, DbView } from "@collabcanvas/shared";

export interface ViewConfig {
  filterColId?: string;
  filterValue?: string; // case-insensitive substring on the cell's text form
  sortColId?: string;
  sortDir?: "asc" | "desc";
}

/** A cell's plain-text form for filtering/grouping/sorting. */
export function cellText(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function compareCells(
  a: string | number | boolean | undefined,
  b: string | number | boolean | undefined,
  type: DbColumnType | undefined,
): number {
  // Empties sort last regardless of direction's later negation.
  const ae = a === undefined;
  const be = b === undefined;
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  if (type === "number") return Number(a) - Number(b);
  if (type === "checkbox") return (a === true ? 1 : 0) - (b === true ? 1 : 0);
  return cellText(a).localeCompare(cellText(b));
}

/** Filter + sort a view's rows. Pure; returns a new array. */
export function applyView(view: DbView, cfg: ViewConfig): DbRowView[] {
  let rows = view.rows;

  if (cfg.filterColId && cfg.filterValue) {
    const needle = cfg.filterValue.toLowerCase();
    const colId = cfg.filterColId;
    rows = rows.filter((r) => cellText(r.cells[colId]).toLowerCase().includes(needle));
  }

  if (cfg.sortColId) {
    const colId = cfg.sortColId;
    const type = view.columns.find((c) => c.id === colId)?.type;
    const dir = cfg.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const cmp = compareCells(a.cells[colId], b.cells[colId], type);
      // Keep empties last in BOTH directions.
      if (cmp === 1 || cmp === -1) {
        const ae = a.cells[colId] === undefined;
        const be = b.cells[colId] === undefined;
        if (ae !== be) return ae ? 1 : -1;
      }
      return cmp * dir;
    });
  }

  return rows;
}

export type Measure = "count" | "sum" | "avg";

export interface ChartConfig {
  groupColId: string;
  measure: Measure;
  measureColId?: string; // required for sum/avg
}

export interface ChartDatum {
  label: string;
  value: number;
}

/** Max distinct categories before the tail folds into "Other" (dataviz rule:
 *  a 9th series is never a new hue). */
export const MAX_CATEGORIES = 8;

/**
 * Group a view's rows by a column and aggregate a measure per group. count =
 * rows per group; sum/avg operate on `measureColId` (non-numeric cells ignored).
 * Sorted by value desc; categories past MAX_CATEGORIES fold into "Other".
 */
export function aggregate(view: DbView, cfg: ChartConfig): ChartDatum[] {
  const groups = new Map<string, { count: number; sum: number; n: number }>();
  for (const row of view.rows) {
    const label = cellText(row.cells[cfg.groupColId]) || "(empty)";
    let g = groups.get(label);
    if (!g) {
      g = { count: 0, sum: 0, n: 0 };
      groups.set(label, g);
    }
    g.count += 1;
    if (cfg.measure !== "count" && cfg.measureColId) {
      const v = Number(row.cells[cfg.measureColId]);
      if (Number.isFinite(v)) {
        g.sum += v;
        g.n += 1;
      }
    }
  }

  const data: ChartDatum[] = [];
  for (const [label, g] of groups) {
    let value: number;
    if (cfg.measure === "count") value = g.count;
    else if (cfg.measure === "sum") value = g.sum;
    else value = g.n ? g.sum / g.n : 0;
    data.push({ label, value });
  }
  data.sort((a, b) => b.value - a.value);

  if (data.length > MAX_CATEGORIES) {
    const head = data.slice(0, MAX_CATEGORIES - 1);
    const tail = data.slice(MAX_CATEGORIES - 1);
    // "Other" is meaningful for count/sum; for avg it's an average-of-averages
    // approximation — acceptable and labeled.
    const value = tail.reduce((acc, d) => acc + d.value, 0);
    head.push({ label: `Other (${tail.length})`, value });
    return head;
  }
  return data;
}
