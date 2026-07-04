/**
 * N8 export harness — the PURE export generators (web/lib/exporters.ts).
 * Deterministic string output; no servers, no DOM.
 *
 * Run:  npx tsx scripts/phase-n8-exports.ts
 */

import type { BoardData, DbView } from "../packages/shared/src/index";
import {
  boardToHtml,
  boardToMarkdown,
  databaseToCsv,
  databaseToHtml,
  htmlEscape,
} from "../web/lib/exporters";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

const view: DbView = {
  title: "Tasks",
  columns: [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "done", name: "Done", type: "checkbox", options: [] },
    { id: "notes", name: "Notes", type: "text", options: [] },
    { id: "files", name: "Files", type: "attachment", options: [] },
  ],
  rows: [
    { id: "r1", cells: { name: "Alpha", done: true, notes: 'has "quotes", and, commas' } },
    { id: "r2", cells: { name: "Bravo", done: false, files: JSON.stringify([{ id: "a", name: "spec.pdf", size: 1 }]) } },
  ],
};

// -- CSV -------------------------------------------------------------------
const csv = databaseToCsv(view);
const lines = csv.split("\r\n");
check("csv: header row", lines[0] === "Name,Done,Notes,Files");
check("csv: boolean → TRUE/FALSE", lines[1].startsWith("Alpha,TRUE,"));
check("csv: quotes+commas escaped (RFC 4180)", lines[1].includes('"has ""quotes"", and, commas"'));
check("csv: attachment cell exports file names", lines[2].includes("spec.pdf"));
check("csv: empty cell is blank", lines[1].endsWith(",")); // Files empty on r1
check("csv: row count = header + data", lines.length === 3);

// CSV / formula injection
const inj = (v: string | number): string => {
  const t: DbView = {
    title: "x",
    columns: [{ id: "a", name: "A", type: typeof v === "number" ? "number" : "text", options: [] }],
    rows: [{ id: "r", cells: { a: v } }],
  };
  return databaseToCsv(t).split("\r\n")[1];
};
check("csv: neutralizes leading = (formula injection)", inj("=SUM(1)") === "'=SUM(1)");
check("csv: neutralizes leading @/|", inj("@x") === "'@x");
check("csv: neutralizes leading - on non-number", inj("-cmd").startsWith("'-cmd"));
check("csv: preserves signed numbers", inj(-5) === "-5");

// -- Markdown --------------------------------------------------------------
const board: BoardData = {
  title: "Sprint",
  columns: [
    { id: "c1", title: "Todo", cards: [{ id: "k1", title: "Task A", description: "line1\nline2" }] },
    { id: "c2", title: "Done", cards: [] },
  ],
};
const md = boardToMarkdown(board);
check("md: h1 title", md.startsWith("# Sprint"));
check("md: column heading with count", md.includes("## Todo (1)"));
check("md: card bullet", md.includes("- **Task A**"));
check("md: multi-line description indented", md.includes("  line1") && md.includes("  line2"));
check("md: empty column shows _No cards_", md.includes("## Done (0)") && md.includes("_No cards_"));

// -- HTML escaping / documents --------------------------------------------
check("html: escapes < > & \"", htmlEscape('a<b>&"c') === "a&lt;b&gt;&amp;&quot;c");
const bh = boardToHtml(board);
check("html board: is a full document", bh.startsWith("<!doctype html>") && bh.includes("<h1>Sprint</h1>"));
check("html board: card rendered", bh.includes("<strong>Task A</strong>"));
const dh = databaseToHtml(view);
check("html db: has a table with headers", dh.includes("<th>Name</th>") && dh.includes("<table>"));
check("html db: escapes cell content", dh.includes("&quot;quotes&quot;"));

console.log(`\nphase-n8: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
