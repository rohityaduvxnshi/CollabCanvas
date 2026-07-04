/**
 * Pure export generators (N8) — no Yjs, no DOM, no deps. Deterministic string
 * output so the harness can verify them. The client turns these into file
 * downloads; PDF is left to the browser's print dialog (honest fidelity —
 * documented). CSV opens natively in Excel; the HTML document opens in Word.
 */

import type { BoardData, DbColumnView, DbView } from "@collabcanvas/shared";

// --- CSV (database → Excel-openable) --------------------------------------

/** Neutralize CSV/formula injection: a leading = @ | (or a + / - that isn't a
 *  signed number, or a control char) makes Excel evaluate the cell as a formula.
 *  Prefix with a single quote so Excel shows it as text; signed numbers are
 *  left intact (they export as clean numbers). */
function csvNeutralize(s: string): string {
  return /^[=@|\t\r]/.test(s) || /^[+-](?![0-9.])/.test(s) ? `'${s}` : s;
}

function csvField(s: string): string {
  const v = csvNeutralize(s);
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function cellText(col: DbColumnView, value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  if (col.type === "attachment" && typeof value === "string") {
    try {
      const files = JSON.parse(value) as { name?: string }[];
      return Array.isArray(files) ? files.map((f) => f?.name ?? "").filter(Boolean).join("; ") : "";
    } catch {
      return "";
    }
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

export function databaseToCsv(view: DbView): string {
  const header = view.columns.map((c) => csvField(c.name)).join(",");
  const rows = view.rows.map((r) =>
    view.columns.map((c) => csvField(cellText(c, r.cells[c.id]))).join(","),
  );
  return [header, ...rows].join("\r\n");
}

// --- Markdown (board) -----------------------------------------------------

export function boardToMarkdown(board: BoardData): string {
  const lines: string[] = [`# ${board.title}`, ""];
  for (const col of board.columns) {
    lines.push(`## ${col.title} (${col.cards.length})`, "");
    if (col.cards.length === 0) lines.push("_No cards_", "");
    for (const card of col.cards) {
      lines.push(`- **${card.title}**`);
      if (card.description) {
        for (const dl of card.description.split("\n")) lines.push(`  ${dl}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

// --- HTML document (board / database → Word-openable, print-to-PDF) --------

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wrap body HTML in a minimal, print-friendly document (Word opens this too). */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;color:#1c1a17;max-width:820px;margin:24px auto;padding:0 16px;}
h1{font-size:24px;} h2{font-size:18px;margin-top:20px;}
table{border-collapse:collapse;width:100%;} th,td{border:1px solid #999;padding:5px 8px;text-align:left;font-size:13px;}
th{background:#eee;} .card{margin:4px 0;} .desc{color:#555;font-size:13px;margin:2px 0 8px 16px;white-space:pre-wrap;}
@media print{body{margin:0;}}
</style></head><body>${body}</body></html>`;
}

export function boardToHtml(board: BoardData): string {
  const cols = board.columns
    .map((col) => {
      const cards = col.cards
        .map(
          (c) =>
            `<div class="card">• <strong>${htmlEscape(c.title)}</strong></div>` +
            (c.description ? `<div class="desc">${htmlEscape(c.description)}</div>` : ""),
        )
        .join("");
      return `<h2>${htmlEscape(col.title)} (${col.cards.length})</h2>${cards || "<p><em>No cards</em></p>"}`;
    })
    .join("");
  return htmlDocument(board.title, `<h1>${htmlEscape(board.title)}</h1>${cols}`);
}

export function databaseToHtml(view: DbView): string {
  const head = view.columns.map((c) => `<th>${htmlEscape(c.name)}</th>`).join("");
  const body = view.rows
    .map(
      (r) =>
        `<tr>${view.columns.map((c) => `<td>${htmlEscape(cellText(c, r.cells[c.id]))}</td>`).join("")}</tr>`,
    )
    .join("");
  return htmlDocument(
    view.title,
    `<h1>${htmlEscape(view.title)}</h1><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  );
}
