/**
 * First-sync initialization for a database doc (N4): set the title and, if the
 * database is brand new (no columns yet), seed a sensible starter schema — a
 * Name (text), Status (select), and Done (checkbox) column plus one empty row —
 * so the table isn't a blank void. Idempotent: only seeds when columnOrder is
 * empty, guarded in one transaction.
 */

import * as Y from "yjs";
import {
  getDbColumnOrder,
  getDbColumns,
  getDbMeta,
  getDbRowOrder,
  getDbRows,
  makeDbColumn,
  makeDbRow,
} from "./dbSchema";

// DETERMINISTIC seed ids: if two clients open a brand-new database within the
// seed window they both run this, but the fixed ids mean their columns/rows
// collide by id and converge to ONE schema through deriveDbView's dedupe
// (and Map LWW keeps one Y.Map per id) — no doubled table. User-added
// columns/rows use random ids, so they never collide with these.
const SEED_COLS: [string, string, "text" | "select" | "checkbox"][] = [
  ["seed-col-name", "Name", "text"],
  ["seed-col-status", "Status", "select"],
  ["seed-col-done", "Done", "checkbox"],
];
const SEED_ROW_ID = "seed-row-1";

export function ensureDbSeed(doc: Y.Doc, title: string): void {
  const meta = getDbMeta(doc);
  const columnOrder = getDbColumnOrder(doc);
  const columns = getDbColumns(doc);
  const rowOrder = getDbRowOrder(doc);
  const rows = getDbRows(doc);

  doc.transact(() => {
    if (!meta.get("title")) meta.set("title", title);
    // Seed ONCE: skip if we've seeded before (meta flag) OR the db already has
    // columns (pre-flag databases). Without the flag, a user who deletes every
    // column would get the starter schema re-injected on the next reload.
    if (meta.get("seeded") || columnOrder.length > 0) return;
    meta.set("seeded", true);

    for (const [id, name, type] of SEED_COLS) {
      const col = makeDbColumn(id, name, type);
      columns.set(id, col); // integrate BEFORE mutating the nested options array
      columnOrder.push([id]);
      if (type === "select") {
        (col.get("options") as Y.Array<string>).push(["Todo", "In progress", "Done"]);
      }
    }

    rows.set(SEED_ROW_ID, makeDbRow(SEED_ROW_ID));
    rowOrder.push([SEED_ROW_ID]);
    meta.set("updatedAt", Date.now());
  });
}
