/**
 * Formula evaluator.
 *
 * Input is whatever the user typed into a cell. Branches:
 *   - empty       → empty string
 *   - non-formula → number (if it parses) or string
 *   - formula     → tokenize → parse → evaluate
 *
 * Cell references inside a formula must already be resolved to `colId@rowId`
 * cell ids by the caller (`rewriteA1Refs` in `lib/spreadsheet/initial.ts`).
 *
 * The whole-grid recalc lives in `evaluateCellGraph`. It does a pull-based,
 * recursive evaluation with cycle detection (a self-reference, or any cycle,
 * short-circuits to `#ERR`).
 *
 * Range expansion happens inside the evaluator: a `RangeNode` resolves to the
 * list of cell ids in its rectangle by looking up the column + row
 * coordinates of the start/end refs. Functions iterate the resulting cell
 * ids to read values via the same `resolveRef` callback.
 */

import { getFunction } from "./functions";
import { parse } from "./parser";
import {
  SyntaxKind,
  type AstNode,
  type BinaryExpressionNode,
  type ExpressionResult,
  type FunctionArg,
  type FunctionCallNode,
  type RangeNode,
  type UnaryExpressionNode,
} from "./syntax";
import { tokenize } from "./tokenizer";
import { isNumerical } from "./utils";

export type { ExpressionResult } from "./syntax";

/**
 * Spreadsheet shape needed to expand a range — the ordered column + row id
 * arrays so we can find the rectangle between two arbitrary cell ids.
 * Optionally carries workbook-scoped named ranges; passing them lets
 * `=Revenue` and other identifier-style refs resolve to their stored range.
 */
export type GridShape = {
  columnIds: readonly string[];
  rowIds: readonly string[];
  namedRanges?: Readonly<
    Record<string, { sheetId: string; startRef: string; endRef: string }>
  >;
};

/**
 * Resolves a single cell id to its scalar value. Used for both single Ref
 * dereferencing and inside-range value lookups.
 *
 * The `empty` case is distinct from `string ""`: empty means the cell
 * doesn't exist or has no value at all — `SUM` skips it, `COUNTA` skips it,
 * `COUNT` skips it. An actual `""` value is treated as a string.
 */
export type CellValueResolver = (cellId: string) => {
  type: "number" | "string" | "error" | "empty";
  value: number | string;
};

export function evaluateExpression(
  input: string,
  shape: GridShape,
  resolveValue: CellValueResolver,
): ExpressionResult {
  if (input.length === 0) return { type: "string", value: "" };
  if (input[0] !== "=") {
    return isNumerical(input)
      ? { type: "number", value: Number(input) }
      : { type: "string", value: input };
  }
  try {
    const tokens = tokenize(input.slice(1));
    // Unresolved A1 cell tokens at this point mean the rewrite step in
    // `setCellValue` was skipped — defensive: treat as error.
    for (const t of tokens) {
      if (t.kind === SyntaxKind.CellToken) return { type: "error" };
    }
    const ast = parse(tokens);
    return evalAst(ast, shape, resolveValue);
  } catch {
    return { type: "error" };
  }
}

function evalAst(
  node: AstNode,
  shape: GridShape,
  resolve: CellValueResolver,
): ExpressionResult {
  switch (node.kind) {
    case SyntaxKind.NumberLiteral:
      return { type: "number", value: node.value };
    case SyntaxKind.StringLiteral:
      return { type: "string", value: node.value };
    case SyntaxKind.Ref: {
      const v = resolve(node.ref);
      if (v.type === "empty") return { type: "number", value: 0 };
      if (v.type === "error") return { type: "error" };
      if (v.type === "number") return { type: "number", value: v.value as number };
      return { type: "string", value: v.value as string };
    }
    case SyntaxKind.Range:
      // A bare range in non-function context: collapse to its top-left value,
      // mirroring Google Sheets' implicit intersection.
      return evalAst({ kind: SyntaxKind.Ref, ref: node.startRef }, shape, resolve);
    case SyntaxKind.NamedRef: {
      // Bare named-range reference outside a function: collapse to its
      // top-left value, just like a plain range does above. Lookup is
      // case-insensitive to match Excel / Sheets — `=Revenue`, `=REVENUE`,
      // and `=revenue` all resolve to the same definition.
      const named = lookupNamedRange(shape, node.name);
      if (!named) return { type: "error" };
      return evalAst(
        { kind: SyntaxKind.Ref, ref: named.startRef },
        shape,
        resolve,
      );
    }
    case SyntaxKind.UnaryExpression: {
      const u = node as UnaryExpressionNode;
      const v = evalAst(u.operand, shape, resolve);
      if (v.type !== "number") return { type: "error" };
      return {
        type: "number",
        value: u.operator === SyntaxKind.MinusToken ? -v.value : v.value,
      };
    }
    case SyntaxKind.BinaryExpression: {
      const b = node as BinaryExpressionNode;
      const lr = evalAst(b.left, shape, resolve);
      const rr = evalAst(b.right, shape, resolve);

      // String concat via `&`. Coerces both sides to string regardless of
      // their evaluated type (matches Excel/Sheets).
      if (b.operator === SyntaxKind.AmpersandToken) {
        return { type: "string", value: stringifyForConcat(lr) + stringifyForConcat(rr) };
      }

      // Comparison operators return booleans. Type-mixed comparisons follow
      // Sheets rules: same-type compares directly; different-type compares
      // by type rank (numbers < strings < booleans).
      if (isComparison(b.operator)) {
        return compareOp(lr, rr, b.operator);
      }

      // Implicit `+` concat when either side is a string (legacy behavior;
      // most users still type `=A1+" "+B1` so we keep it).
      if (b.operator === SyntaxKind.PlusToken && (lr.type === "string" || rr.type === "string")) {
        return {
          type: "string",
          value: stringifyForConcat(lr) + stringifyForConcat(rr),
        };
      }
      if (lr.type !== "number" || rr.type !== "number") return { type: "error" };
      const l = lr.value;
      const r = rr.value;
      switch (b.operator) {
        case SyntaxKind.PlusToken:
          return { type: "number", value: l + r };
        case SyntaxKind.MinusToken:
          return { type: "number", value: l - r };
        case SyntaxKind.AsteriskToken:
          return { type: "number", value: l * r };
        case SyntaxKind.SlashToken:
          if (r === 0) return { type: "error" };
          return { type: "number", value: l / r };
        case SyntaxKind.PercentToken:
          if (r === 0) return { type: "error" };
          return { type: "number", value: l % r };
        case SyntaxKind.CaretToken:
          return { type: "number", value: l ** r };
      }
      return { type: "error" };
    }
    case SyntaxKind.FunctionCall: {
      const call = node as FunctionCallNode;
      const fn = getFunction(call.name);
      if (!fn) return { type: "error" };
      // Evaluate each argument. Ranges pass through as `type:"range"` arrays
      // of cell ids; scalars are evaluated first.
      const args: FunctionArg[] = call.args.map((a) => evalAsArg(a, shape, resolve));
      return fn(args, resolve);
    }
  }
}

function evalAsArg(
  node: AstNode,
  shape: GridShape,
  resolve: CellValueResolver,
): FunctionArg {
  if (node.kind === SyntaxKind.Range) {
    const refs = expandRange(node as RangeNode, shape);
    return { type: "range", refs };
  }
  if (node.kind === SyntaxKind.NamedRef) {
    const named = lookupNamedRange(shape, node.name);
    if (!named) return { type: "error" };
    const refs = expandRange(
      {
        kind: SyntaxKind.Range,
        startRef: named.startRef,
        endRef: named.endRef,
      },
      shape,
    );
    return { type: "range", refs };
  }
  const r = evalAst(node, shape, resolve);
  return r;
}

/**
 * Case-insensitive named-range lookup. Returns the first matching definition
 * by lowercased name, or `null`. Excel / Sheets treat names this way; we do
 * the same so users don't have to remember capitalization.
 *
 * Cross-sheet caveat: the evaluator only knows the *active* sheet's column
 * / row id arrays (passed via `shape`). A named range pointing into another
 * sheet's storage will have refs whose ids don't appear in `shape.columnIds`
 * / `shape.rowIds`, so `expandRange` returns `[]` and aggregators silently
 * yield zero. To avoid that misleading zero we explicitly return `null`
 * when the named range's `sheetId` doesn't match the active shape — surfacing
 * `#ERR` to the user, which is the honest result until cross-sheet refs are
 * wired through the evaluator.
 *
 * Same-sheet lookups (the common case) work as before.
 */
function lookupNamedRange(
  shape: GridShape,
  name: string,
): { sheetId: string; startRef: string; endRef: string } | null {
  if (!shape.namedRanges) return null;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(shape.namedRanges)) {
    if (k.toLowerCase() === target) {
      // Cross-sheet refs aren't supported by the evaluator yet — if the
      // range's home sheet is different from the active shape's sheet, we
      // can't expand it correctly. Surface that as an error rather than
      // silently summing to zero.
      const startSheet = sheetIdFor(v.startRef, shape);
      if (startSheet === null) return null;
      return v;
    }
  }
  return null;
}

/**
 * Returns "ok" if the ref's column/row both live in the active shape, `null`
 * otherwise. Used by `lookupNamedRange` to guard against cross-sheet refs
 * the evaluator can't resolve yet.
 */
function sheetIdFor(ref: string, shape: GridShape): "ok" | null {
  const at = ref.indexOf("@");
  if (at <= 0) return null;
  const colId = ref.slice(0, at);
  const rowId = ref.slice(at + 1);
  if (shape.columnIds.indexOf(colId) < 0) return null;
  if (shape.rowIds.indexOf(rowId) < 0) return null;
  return "ok";
}

function isComparison(op: SyntaxKind): boolean {
  return (
    op === SyntaxKind.EqualsToken ||
    op === SyntaxKind.NotEqualsToken ||
    op === SyntaxKind.LessThanToken ||
    op === SyntaxKind.LessEqualToken ||
    op === SyntaxKind.GreaterThanToken ||
    op === SyntaxKind.GreaterEqualToken
  );
}

function stringifyForConcat(r: ExpressionResult): string {
  if (r.type === "string") return r.value;
  if (r.type === "number") {
    // Trim trailing JS-noise decimals (`0.30000000000000004`).
    const rounded = Math.round(r.value * 1e10) / 1e10;
    return String(rounded);
  }
  if (r.type === "boolean") return r.value ? "TRUE" : "FALSE";
  return "#ERR";
}

/**
 * Type-rank ordering for cross-type comparisons (matches Sheets):
 * numbers < strings < booleans. Within a type, compare directly.
 */
function typeRank(r: ExpressionResult): number {
  switch (r.type) {
    case "number":
      return 1;
    case "string":
      return 2;
    case "boolean":
      return 3;
    default:
      return 0; // error — never returned from compareOp
  }
}

function compareOp(
  lr: ExpressionResult,
  rr: ExpressionResult,
  op: SyntaxKind,
): ExpressionResult {
  if (lr.type === "error" || rr.type === "error") return { type: "error" };
  let cmp: number;
  if (lr.type === rr.type) {
    if (lr.type === "number" && rr.type === "number") {
      cmp = lr.value < rr.value ? -1 : lr.value > rr.value ? 1 : 0;
    } else if (lr.type === "string" && rr.type === "string") {
      cmp = lr.value.localeCompare(rr.value);
    } else if (lr.type === "boolean" && rr.type === "boolean") {
      cmp = lr.value === rr.value ? 0 : lr.value ? 1 : -1;
    } else {
      cmp = 0;
    }
  } else {
    cmp = typeRank(lr) - typeRank(rr);
  }
  let result = false;
  switch (op) {
    case SyntaxKind.EqualsToken:
      result = cmp === 0;
      break;
    case SyntaxKind.NotEqualsToken:
      result = cmp !== 0;
      break;
    case SyntaxKind.LessThanToken:
      result = cmp < 0;
      break;
    case SyntaxKind.LessEqualToken:
      result = cmp <= 0;
      break;
    case SyntaxKind.GreaterThanToken:
      result = cmp > 0;
      break;
    case SyntaxKind.GreaterEqualToken:
      result = cmp >= 0;
      break;
  }
  return { type: "boolean", value: result };
}

/**
 * Returns every `colId@rowId` in the rectangle bounded by `startRef` and
 * `endRef`. Order: row-major, top-left first. Returns `[]` if either corner
 * is unknown (column or row deleted since the formula was authored).
 */
function expandRange(range: RangeNode, shape: GridShape): string[] {
  const sIdx = splitRef(range.startRef, shape);
  const eIdx = splitRef(range.endRef, shape);
  if (!sIdx || !eIdx) return [];
  const minX = Math.min(sIdx.x, eIdx.x);
  const maxX = Math.max(sIdx.x, eIdx.x);
  const minY = Math.min(sIdx.y, eIdx.y);
  const maxY = Math.max(sIdx.y, eIdx.y);
  const out: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    const rowId = shape.rowIds[y];
    if (!rowId) continue;
    for (let x = minX; x <= maxX; x++) {
      const colId = shape.columnIds[x];
      if (!colId) continue;
      out.push(`${colId}@${rowId}`);
    }
  }
  return out;
}

function splitRef(
  ref: string,
  shape: GridShape,
): { x: number; y: number } | null {
  const at = ref.indexOf("@");
  if (at <= 0) return null;
  const colId = ref.slice(0, at);
  const rowId = ref.slice(at + 1);
  const x = shape.columnIds.indexOf(colId);
  const y = shape.rowIds.indexOf(rowId);
  if (x < 0 || y < 0) return null;
  return { x, y };
}

/**
 * Compute the entire cell graph. Pull-based: every read of a formula cell
 * recursively evaluates its dependencies, and a `visiting` set guards
 * against cycles.
 */
export function evaluateCellGraph(
  rawCells: Map<string, string> | Record<string, string>,
  shape: GridShape,
): Map<string, ExpressionResult> {
  const raw =
    rawCells instanceof Map ? rawCells : new Map(Object.entries(rawCells));
  const out = new Map<string, ExpressionResult>();
  const evaluating = new Set<string>();

  function resolveValue(id: string): ReturnType<CellValueResolver> {
    if (!raw.has(id)) return { type: "empty", value: 0 };
    const r = evaluateOne(id);
    if (r.type === "number") return { type: "number", value: r.value };
    if (r.type === "string")
      return r.value === ""
        ? { type: "empty", value: 0 }
        : { type: "string", value: r.value };
    if (r.type === "boolean") return { type: "number", value: r.value ? 1 : 0 };
    return { type: "error", value: 0 };
  }

  function evaluateOne(id: string): ExpressionResult {
    const cached = out.get(id);
    if (cached) return cached;
    if (evaluating.has(id)) {
      const err: ExpressionResult = { type: "error" };
      out.set(id, err);
      return err;
    }
    const input = raw.get(id) ?? "";
    evaluating.add(id);
    const result = evaluateExpression(input, shape, resolveValue);
    evaluating.delete(id);
    out.set(id, result);
    return result;
  }

  for (const id of raw.keys()) evaluateOne(id);
  return out;
}
