/**
 * N7 formula harness — the safe expression evaluator (web/lib/db/formula.ts)
 * plus its integration into deriveDbView (computed cells, formula-references-
 * formula, cycle detection). Pure; no servers.
 *
 * Run:  npx tsx scripts/phase-n7-formulas.ts
 */

import * as Y from "yjs";
import { evalFormula, type FormulaValue } from "../web/lib/db/formula";
import { createDbActions } from "../web/lib/yjs/dbMutations";
import { deriveDbView } from "../web/lib/yjs/deriveDbView";
import { getDbColumnOrder } from "../web/lib/yjs/dbSchema";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

const R = (m: Record<string, FormulaValue>) => (name: string) => m[name];

// -- evaluator: arithmetic + precedence + parens --------------------------
check("precedence: 1 + 2 * 3 = 7", evalFormula("1 + 2 * 3", R({})) === 7);
check("parens: (1 + 2) * 3 = 9", evalFormula("(1 + 2) * 3", R({})) === 9);
check("unary minus: -5 + 8 = 3", evalFormula("-5 + 8", R({})) === 3);

// -- refs -----------------------------------------------------------------
check("ref arithmetic: [A] + [B]", evalFormula("[A] + [B]", R({ A: 10, B: 5 })) === 15);
check("ref with spaces: [Unit Price] * [Qty]", evalFormula("[Unit Price] * [Qty]", R({ "Unit Price": 4, Qty: 3 })) === 12);
check("empty ref treated as 0 in arithmetic", evalFormula("[Missing] + 7", R({})) === 7);

// -- strings --------------------------------------------------------------
check("string concat via +", evalFormula("[Name] + '!'", R({ Name: "Hi" })) === "Hi!");
check("concat() function", evalFormula("concat('a', 'b', 'c')", R({})) === "abc");
check("number + string concatenates", evalFormula("'#' + [N]", R({ N: 5 })) === "#5");

// -- comparison + if ------------------------------------------------------
check("if pass branch", evalFormula("if([Score] >= 50, 'Pass', 'Fail')", R({ Score: 60 })) === "Pass");
check("if fail branch", evalFormula("if([Score] >= 50, 'Pass', 'Fail')", R({ Score: 40 })) === "Fail");
check("equality on strings", evalFormula("[S] = 'done'", R({ S: "done" })) === true);
check("boolean and/or/not", evalFormula("and(true, or(false, not(false)))", R({})) === true);

// -- aggregate-ish functions ----------------------------------------------
check("sum ignores non-numeric", evalFormula("sum(1, 2, 'x', 3)", R({})) === 6);
check("avg of numerics", evalFormula("avg(2, 4, 6)", R({})) === 4);
check("count of non-empty", evalFormula("count('', 5, 'x', [Missing])", R({})) === 2);
check("min / max", evalFormula("min(3, 1, 2) + max(3, 1, 2)", R({})) === 4);
check("round to 2 dp", evalFormula("round(3.14159, 2)", R({})) === 3.14);

// -- errors (never throw; return #ERR) ------------------------------------
check("division by zero → #ERR", String(evalFormula("1 / 0", R({}))).startsWith("#ERR"));
check("unknown function → #ERR", String(evalFormula("bogus(1)", R({}))).startsWith("#ERR"));
check("non-numeric arithmetic → #ERR", String(evalFormula("'abc' * 2", R({}))).startsWith("#ERR"));
check("unclosed ref → #ERR", String(evalFormula("[A + 1", R({}))).startsWith("#ERR"));
check("trailing junk → #ERR", String(evalFormula("1 2", R({}))).startsWith("#ERR"));
// Safety: no code execution
check("no eval / property access", String(evalFormula("constructor", R({}))).startsWith("#ERR"));

// -- deriveDbView integration ---------------------------------------------
{
  const doc = new Y.Doc();
  const a = createDbActions(doc);
  a.addColumn("Price", "number");
  a.addColumn("Qty", "number");
  a.addColumn("Total", "formula");
  a.addColumn("Tax", "formula");
  a.addRow();

  const cols = deriveDbView(doc).columns;
  const priceId = cols.find((c) => c.name === "Price")!.id;
  const qtyId = cols.find((c) => c.name === "Qty")!.id;
  const totalId = cols.find((c) => c.name === "Total")!.id;
  const taxId = cols.find((c) => c.name === "Tax")!.id;
  const rowId = deriveDbView(doc).rows[0].id;

  a.setColumnFormula(totalId, "[Price] * [Qty]");
  a.setColumnFormula(taxId, "round([Total] * 0.1, 2)"); // formula references a formula
  a.setCell(rowId, priceId, 10);
  a.setCell(rowId, qtyId, 3);

  let cells = deriveDbView(doc).rows[0].cells;
  check("derive: formula cell computed ([Price]*[Qty]=30)", cells[totalId] === 30);
  check("derive: formula references another formula ([Total]*0.1=3)", cells[taxId] === 3);

  // formula cells are NOT stored (setCell on a formula column is a no-op)
  a.setCell(rowId, totalId, 999);
  check("derive: setCell on a formula column is ignored", deriveDbView(doc).rows[0].cells[totalId] === 30);

  // changing an input re-derives the formula
  a.setCell(rowId, qtyId, 5);
  check("derive: recomputes when an input changes (10*5=50)", deriveDbView(doc).rows[0].cells[totalId] === 50);

  // cycle: A -> B -> A
  a.addColumn("CycA", "formula");
  a.addColumn("CycB", "formula");
  const cyc = deriveDbView(doc).columns;
  const cycA = cyc.find((c) => c.name === "CycA")!.id;
  const cycB = cyc.find((c) => c.name === "CycB")!.id;
  a.setColumnFormula(cycA, "[CycB] + 1");
  a.setColumnFormula(cycB, "[CycA] + 1");
  cells = deriveDbView(doc).rows[0].cells;
  check("derive: cycle yields #ERR (no infinite loop)", String(cells[cycA]).includes("#ERR") || String(cells[cycB]).includes("#ERR"));

  // caps: formula added within column cap, and getDbColumnOrder consistent
  check("derive: all columns present", getDbColumnOrder(doc).length === deriveDbView(doc).columns.length);
  doc.destroy();
}

console.log(`\nphase-n7: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
