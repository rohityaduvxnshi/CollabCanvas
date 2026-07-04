/**
 * Safe formula engine for computed database columns (N7).
 *
 * A hand-rolled tokenizer + recursive-descent parser + tree-walking evaluator —
 * NO eval / Function constructor, no property access on objects, no globals.
 * The evaluator only performs arithmetic / string / boolean ops on primitive
 * values resolved from other columns via a caller-supplied `resolve(name)`.
 *
 * Language:
 *   - refs:      [Column Name]         (resolve reads that column's value)
 *   - literals:  12, 3.14, 'hi', "hi", true, false
 *   - operators: + - * /  = != < > <= >=  && || !   (parens group)
 *   - functions: sum avg count min max round abs if concat and or not
 */

export type FormulaValue = string | number | boolean;

export class FormulaError extends Error {}

// --- tokenizer -------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "ref"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isIdent = (c: string) => /[A-Za-z_]/.test(c);

  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = src.indexOf("]", i + 1);
      if (end === -1) throw new FormulaError("Unclosed [ reference");
      toks.push({ t: "ref", v: src.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end === -1) throw new FormulaError("Unclosed string");
      toks.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && (isDigit(src[j]) || src[j] === ".")) j++;
      toks.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (isIdent(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: "ident", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    // multi-char operators first
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "!=" || two === "&&" || two === "||") {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/<>=!".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw new FormulaError(`Unexpected character '${c}'`);
  }
  return toks;
}

// --- parser (AST) ----------------------------------------------------------

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; name: string }
  | { k: "unary"; op: string; e: Node }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "call"; name: string; args: Node[] };

function parse(toks: Tok[]): Node {
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];
  const expectOp = (v: string) => {
    const t = peek();
    if (t && t.t === "op" && t.v === v) { pos++; return true; }
    return false;
  };

  function parseExpr(): Node { return parseOr(); }
  function parseOr(): Node {
    let l = parseAnd();
    while (expectOp("||")) l = { k: "bin", op: "||", l, r: parseAnd() };
    return l;
  }
  function parseAnd(): Node {
    let l = parseEq();
    while (expectOp("&&")) l = { k: "bin", op: "&&", l, r: parseEq() };
    return l;
  }
  function parseEq(): Node {
    let l = parseCmp();
    for (;;) {
      if (expectOp("=")) l = { k: "bin", op: "=", l, r: parseCmp() };
      else if (expectOp("!=")) l = { k: "bin", op: "!=", l, r: parseCmp() };
      else break;
    }
    return l;
  }
  function parseCmp(): Node {
    let l = parseAdd();
    for (;;) {
      if (expectOp("<=")) l = { k: "bin", op: "<=", l, r: parseAdd() };
      else if (expectOp(">=")) l = { k: "bin", op: ">=", l, r: parseAdd() };
      else if (expectOp("<")) l = { k: "bin", op: "<", l, r: parseAdd() };
      else if (expectOp(">")) l = { k: "bin", op: ">", l, r: parseAdd() };
      else break;
    }
    return l;
  }
  function parseAdd(): Node {
    let l = parseMul();
    for (;;) {
      if (expectOp("+")) l = { k: "bin", op: "+", l, r: parseMul() };
      else if (expectOp("-")) l = { k: "bin", op: "-", l, r: parseMul() };
      else break;
    }
    return l;
  }
  function parseMul(): Node {
    let l = parseUnary();
    for (;;) {
      if (expectOp("*")) l = { k: "bin", op: "*", l, r: parseUnary() };
      else if (expectOp("/")) l = { k: "bin", op: "/", l, r: parseUnary() };
      else break;
    }
    return l;
  }
  function parseUnary(): Node {
    if (expectOp("!")) return { k: "unary", op: "!", e: parseUnary() };
    if (expectOp("-")) return { k: "unary", op: "-", e: parseUnary() };
    return parsePrimary();
  }
  function parsePrimary(): Node {
    const t = peek();
    if (!t) throw new FormulaError("Unexpected end of formula");
    if (t.t === "num") { eat(); return { k: "num", v: t.v }; }
    if (t.t === "str") { eat(); return { k: "str", v: t.v }; }
    if (t.t === "ref") { eat(); return { k: "ref", name: t.v }; }
    if (t.t === "lp") {
      eat();
      const e = parseExpr();
      if (peek()?.t !== "rp") throw new FormulaError("Missing )");
      eat();
      return e;
    }
    if (t.t === "ident") {
      eat();
      if (t.v === "true") return { k: "bool", v: true };
      if (t.v === "false") return { k: "bool", v: false };
      // function call
      if (peek()?.t !== "lp") throw new FormulaError(`Unknown name '${t.v}' (functions need parentheses)`);
      eat(); // (
      const args: Node[] = [];
      if (peek()?.t !== "rp") {
        args.push(parseExpr());
        while (peek()?.t === "comma") { eat(); args.push(parseExpr()); }
      }
      if (peek()?.t !== "rp") throw new FormulaError("Missing ) in function call");
      eat();
      return { k: "call", name: t.v.toLowerCase(), args };
    }
    throw new FormulaError("Unexpected token");
  }

  const ast = parseExpr();
  if (pos !== toks.length) throw new FormulaError("Unexpected trailing input");
  return ast;
}

// --- coercion --------------------------------------------------------------

const isEmpty = (v: FormulaValue | undefined) => v === undefined || v === "";

function toNum(v: FormulaValue | undefined): number {
  if (v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FormulaError(`'${v}' is not a number`);
  return n;
}
function toStr(v: FormulaValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
function truthy(v: FormulaValue | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "";
}
const numeric = (v: FormulaValue | undefined): boolean =>
  typeof v === "number" || (typeof v === "string" && v !== "" && Number.isFinite(Number(v)));

// --- evaluator -------------------------------------------------------------

function evalNode(node: Node, resolve: (name: string) => FormulaValue | undefined): FormulaValue {
  switch (node.k) {
    case "num": return node.v;
    case "str": return node.v;
    case "bool": return node.v;
    case "ref": {
      const v = resolve(node.name);
      return v === undefined ? "" : v;
    }
    case "unary": {
      if (node.op === "-") return -toNum(evalNode(node.e, resolve));
      return !truthy(evalNode(node.e, resolve));
    }
    case "bin": {
      const op = node.op;
      if (op === "&&") return truthy(evalNode(node.l, resolve)) && truthy(evalNode(node.r, resolve));
      if (op === "||") return truthy(evalNode(node.l, resolve)) || truthy(evalNode(node.r, resolve));
      const l = evalNode(node.l, resolve);
      const r = evalNode(node.r, resolve);
      if (op === "+") {
        // Concatenate only when a side is a NON-EMPTY non-numeric string;
        // otherwise numeric add (an empty "" counts as 0, like a spreadsheet).
        const lTxt = typeof l === "string" && l !== "" && !numeric(l);
        const rTxt = typeof r === "string" && r !== "" && !numeric(r);
        if (lTxt || rTxt) return toStr(l) + toStr(r);
        return toNum(l) + toNum(r);
      }
      if (op === "-") return toNum(l) - toNum(r);
      if (op === "*") return toNum(l) * toNum(r);
      if (op === "/") {
        const d = toNum(r);
        if (d === 0) throw new FormulaError("Division by zero");
        return toNum(l) / d;
      }
      if (op === "=" || op === "!=") {
        const eq = numeric(l) && numeric(r) ? toNum(l) === toNum(r) : toStr(l) === toStr(r);
        return op === "=" ? eq : !eq;
      }
      // < > <= >=
      const cmp = numeric(l) && numeric(r) ? toNum(l) - toNum(r) : toStr(l).localeCompare(toStr(r));
      if (op === "<") return cmp < 0;
      if (op === ">") return cmp > 0;
      if (op === "<=") return cmp <= 0;
      return cmp >= 0;
    }
    case "call": {
      const a = node.args.map((x) => evalNode(x, resolve));
      switch (node.name) {
        case "sum": return a.filter(numeric).reduce<number>((s, x) => s + toNum(x), 0);
        case "avg": {
          const nums = a.filter(numeric);
          return nums.length ? nums.reduce<number>((s, x) => s + toNum(x), 0) / nums.length : 0;
        }
        case "count": return a.filter((x) => !isEmpty(x)).length;
        case "min": { const nums = a.filter(numeric).map(toNum); return nums.length ? Math.min(...nums) : 0; }
        case "max": { const nums = a.filter(numeric).map(toNum); return nums.length ? Math.max(...nums) : 0; }
        case "abs": return Math.abs(toNum(a[0]));
        case "round": {
          const p = a[1] === undefined ? 0 : toNum(a[1]);
          const f = 10 ** p;
          return Math.round(toNum(a[0]) * f) / f;
        }
        case "if": {
          if (a.length < 2) throw new FormulaError("if needs (condition, then, else?)");
          return truthy(a[0]) ? a[1] : a[2] ?? "";
        }
        case "concat": return a.map(toStr).join("");
        case "and": return a.every(truthy);
        case "or": return a.some(truthy);
        case "not": return !truthy(a[0]);
        default: throw new FormulaError(`Unknown function '${node.name}'`);
      }
    }
  }
}

/** Compile a formula once; the returned fn evaluates it against a resolver.
 *  Throws FormulaError on a parse error (surface it when saving the formula). */
export function compileFormula(
  src: string,
): (resolve: (name: string) => FormulaValue | undefined) => FormulaValue {
  const ast = parse(tokenize(src));
  return (resolve) => evalNode(ast, resolve);
}

/** One-shot evaluate; returns the value or an "#ERR" string (never throws). */
export function evalFormula(
  src: string,
  resolve: (name: string) => FormulaValue | undefined,
): FormulaValue {
  try {
    return compileFormula(src)(resolve);
  } catch (e) {
    return `#ERR: ${(e as Error).message}`;
  }
}
