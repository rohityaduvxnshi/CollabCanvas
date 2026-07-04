"use client";

/**
 * DbViewPanel (N6) — the view layer over a database: a Table mode with
 * filter/sort, and a Chart mode (group-by + measure → bar/pie). View state is
 * client-side/ephemeral (v1 — not collaborative); the underlying data is the
 * live DbView. Lives in lib/db (consumes the pure dbView transforms + the
 * presentational table/chart components).
 */

import { useState } from "react";
import type { DbActions, DbView } from "@collabcanvas/shared";
import { DatabaseTable } from "@/components/db/DatabaseTable";
import { DatabaseChart } from "@/components/db/DatabaseChart";
import { aggregate, applyView, type Measure } from "./dbView";

const SELECT =
  "rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-1 font-sans text-[12px] font-semibold text-[var(--ink)] outline-none";
const CHIP = "cc-press rounded-[9px] border-2 border-[var(--line)] px-2.5 py-1 font-display text-[12px] font-semibold shadow-[2px_2px_0_var(--shadow)]";

export function DbViewPanel({
  data,
  actions,
  databaseId,
  canEdit,
}: {
  data: DbView;
  actions: DbActions | null;
  databaseId: string;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<"table" | "chart">("table");
  const [filterCol, setFilterCol] = useState("");
  const [filterVal, setFilterVal] = useState("");
  const [sortCol, setSortCol] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [groupCol, setGroupCol] = useState("");
  const [measure, setMeasure] = useState<Measure>("count");
  const [measureCol, setMeasureCol] = useState("");
  const [chartType, setChartType] = useState<"bar" | "pie">("bar");

  const numberCols = data.columns.filter((c) => c.type === "number");
  const effGroup = groupCol || data.columns[0]?.id || "";
  const effMeasureCol = measureCol || numberCols[0]?.id || "";

  // No manual useMemo — the React Compiler auto-memoizes these pure derivations
  // (a manual memo here conflicts with preserve-manual-memoization).
  const filteredView: DbView = {
    ...data,
    rows: applyView(data, {
      filterColId: filterCol || undefined,
      filterValue: filterVal || undefined,
      sortColId: sortCol || undefined,
      sortDir,
    }),
  };

  const chartData = aggregate(data, {
    groupColId: effGroup,
    measure,
    measureColId: measure === "count" ? undefined : effMeasureCol,
  });

  const measureLabel =
    measure === "count"
      ? "Count"
      : `${measure === "sum" ? "Sum" : "Avg"} of ${data.columns.find((c) => c.id === effMeasureCol)?.name ?? "?"}`;

  return (
    <div className="flex flex-col gap-3">
      {/* mode + view controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => setMode("table")}
            className={`${CHIP} ${mode === "table" ? "bg-[var(--ink)] text-[var(--app)]" : "bg-[var(--surface)] text-[var(--ink)]"}`}
          >
            Table
          </button>
          <button
            onClick={() => setMode("chart")}
            className={`${CHIP} ${mode === "chart" ? "bg-[var(--ink)] text-[var(--app)]" : "bg-[var(--surface)] text-[var(--ink)]"}`}
          >
            Chart
          </button>
        </div>

        {mode === "table" ? (
          <>
            <select className={SELECT} value={filterCol} onChange={(e) => setFilterCol(e.target.value)} aria-label="Filter column">
              <option value="">Filter…</option>
              {data.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {filterCol ? (
              <input
                className={SELECT}
                value={filterVal}
                onChange={(e) => setFilterVal(e.target.value)}
                placeholder="contains…"
                aria-label="Filter value"
              />
            ) : null}
            <select className={SELECT} value={sortCol} onChange={(e) => setSortCol(e.target.value)} aria-label="Sort column">
              <option value="">Sort…</option>
              {data.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {sortCol ? (
              <button className={`${CHIP} bg-[var(--surface)] text-[var(--ink)]`} onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
                {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <select className={SELECT} value={effGroup} onChange={(e) => setGroupCol(e.target.value)} aria-label="Group by">
              {data.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  Group by {c.name}
                </option>
              ))}
            </select>
            <select className={SELECT} value={measure} onChange={(e) => setMeasure(e.target.value as Measure)} aria-label="Measure">
              <option value="count">Count</option>
              <option value="sum" disabled={numberCols.length === 0}>
                Sum
              </option>
              <option value="avg" disabled={numberCols.length === 0}>
                Average
              </option>
            </select>
            {measure !== "count" && numberCols.length > 0 ? (
              <select className={SELECT} value={effMeasureCol} onChange={(e) => setMeasureCol(e.target.value)} aria-label="Measure column">
                {numberCols.map((c) => (
                  <option key={c.id} value={c.id}>
                    of {c.name}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="flex gap-1">
              <button onClick={() => setChartType("bar")} className={`${CHIP} ${chartType === "bar" ? "bg-[var(--sun)] text-[#1c1a17]" : "bg-[var(--surface)] text-[var(--ink)]"}`}>
                Bar
              </button>
              <button onClick={() => setChartType("pie")} className={`${CHIP} ${chartType === "pie" ? "bg-[var(--sun)] text-[#1c1a17]" : "bg-[var(--surface)] text-[var(--ink)]"}`}>
                Pie
              </button>
            </div>
          </>
        )}
      </div>

      {mode === "table" ? (
        <DatabaseTable data={filteredView} actions={canEdit ? actions : null} databaseId={databaseId} />
      ) : (
        <DatabaseChart data={chartData} type={chartType} measureLabel={measureLabel} />
      )}
    </div>
  );
}
