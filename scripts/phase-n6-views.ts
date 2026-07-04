/**
 * N6 views/charts harness — the PURE view + aggregation logic (web/lib/db/dbView.ts).
 * Filter/sort/group/aggregate over a hand-built DbView; no servers, no Yjs.
 *
 * Run:  npx tsx scripts/phase-n6-views.ts
 */

import type { DbView } from "../packages/shared/src/index";
import { aggregate, applyView, MAX_CATEGORIES } from "../web/lib/db/dbView";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

const view: DbView = {
  title: "T",
  columns: [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "status", name: "Status", type: "select", options: ["Todo", "Doing", "Done"] },
    { id: "score", name: "Score", type: "number", options: [] },
  ],
  rows: [
    { id: "r1", cells: { name: "Alpha", status: "Todo", score: 10 } },
    { id: "r2", cells: { name: "Bravo", status: "Done", score: 30 } },
    { id: "r3", cells: { name: "Charlie", status: "Todo", score: 20 } },
    { id: "r4", cells: { name: "Delta", status: "Done", score: 40 } },
    { id: "r5", cells: { name: "Echo", status: "Doing" } }, // no score
  ],
};

// -- filter ----------------------------------------------------------------
check(
  "filter: substring match (case-insensitive)",
  applyView(view, { filterColId: "name", filterValue: "a" }).map((r) => r.id).join(",") ===
    "r1,r2,r3,r4", // Alpha, Bravo, Charlie, Delta contain 'a'; Echo doesn't
);
check(
  "filter: on a select column",
  applyView(view, { filterColId: "status", filterValue: "done" }).map((r) => r.id).sort().join(",") ===
    "r2,r4",
);
check("filter: no config returns all rows", applyView(view, {}).length === 5);

// -- sort ------------------------------------------------------------------
check(
  "sort: number ascending",
  applyView(view, { sortColId: "score", sortDir: "asc" }).map((r) => r.id).join(",") ===
    "r1,r3,r2,r4,r5", // 10,20,30,40, then empty last
);
check(
  "sort: number descending keeps empty last",
  applyView(view, { sortColId: "score", sortDir: "desc" }).map((r) => r.id).join(",") ===
    "r4,r2,r3,r1,r5", // 40,30,20,10, empty still last
);
check(
  "sort: text ascending",
  applyView(view, { sortColId: "name", sortDir: "asc" }).map((r) => r.cells.name).join(",") ===
    "Alpha,Bravo,Charlie,Delta,Echo",
);

// -- aggregate: count ------------------------------------------------------
{
  const agg = aggregate(view, { groupColId: "status", measure: "count" });
  const byLabel = Object.fromEntries(agg.map((d) => [d.label, d.value]));
  check("aggregate count: Todo=2, Done=2, Doing=1", byLabel.Todo === 2 && byLabel.Done === 2 && byLabel.Doing === 1);
  check("aggregate: sorted by value desc", agg[0].value >= agg[agg.length - 1].value);
}

// -- aggregate: sum / avg --------------------------------------------------
{
  const sum = aggregate(view, { groupColId: "status", measure: "sum", measureColId: "score" });
  const byLabel = Object.fromEntries(sum.map((d) => [d.label, d.value]));
  check("aggregate sum: Todo=30 (10+20), Done=70 (30+40)", byLabel.Todo === 30 && byLabel.Done === 70);
  const avg = aggregate(view, { groupColId: "status", measure: "avg", measureColId: "score" });
  const avgL = Object.fromEntries(avg.map((d) => [d.label, d.value]));
  check("aggregate avg: Todo=15, Done=35", avgL.Todo === 15 && avgL.Done === 35);
  check("aggregate avg: group with no numeric values = 0 (Doing)", avgL.Doing === 0);
}

// -- Other-fold ------------------------------------------------------------
{
  const many: DbView = {
    title: "M",
    columns: [{ id: "k", name: "K", type: "text", options: [] }],
    rows: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, cells: { k: `cat${i}` } })),
  };
  const agg = aggregate(many, { groupColId: "k", measure: "count" });
  check("Other-fold: caps at MAX_CATEGORIES rows", agg.length === MAX_CATEGORIES);
  check("Other-fold: last bucket is labeled Other", agg[agg.length - 1].label.startsWith("Other"));
  check(
    "Other-fold: total is preserved",
    agg.reduce((a, d) => a + d.value, 0) === 20,
  );
}

// -- empty group label -----------------------------------------------------
check(
  "aggregate: missing group cell → (empty) bucket",
  aggregate(view, { groupColId: "score", measure: "count" }).some((d) => d.label === "(empty)"),
);

console.log(`\nphase-n6: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
