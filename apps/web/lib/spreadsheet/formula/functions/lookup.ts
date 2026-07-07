/**
 * Lookup / reference functions: VLOOKUP, HLOOKUP, INDEX, MATCH, XLOOKUP,
 * CHOOSE. ROW / COLUMN / ROWS / COLUMNS too.
 *
 * Lookups operate on the cell-id arrays inside a `range` arg. The functions
 * here don't need to know about the sheet shape — the caller hands us the
 * range expansion already.
 */

import type { FunctionArg } from "../syntax";
import {
  argToScalarInt,
  argToScalarNumber,
  argToScalarString,
  type FunctionImpl,
  type ResolveValue,
} from "./_helpers";

/** Read one cell as a scalar. */
function readCell(
  ref: string,
  resolve: ResolveValue,
): { type: "number" | "string" | "empty"; value: unknown } {
  const v = resolve(ref);
  if (v.type === "error") return { type: "empty", value: null };
  return { type: v.type, value: v.value };
}

/**
 * Determine the rectangle shape of a range. Cell ids are `colId@rowId`. The
 * range's refs are emitted in row-major order by `expandRange` in the
 * evaluator. We rediscover the row/col count by counting unique col / row
 * tokens. (Cheap — at most a few-thousand entries.)
 */
function rangeShape(refs: string[]): { rows: number; cols: number } {
  if (refs.length === 0) return { rows: 0, cols: 0 };
  const colSet = new Set<string>();
  const rowSet = new Set<string>();
  for (const r of refs) {
    const at = r.indexOf("@");
    if (at <= 0) continue;
    colSet.add(r.slice(0, at));
    rowSet.add(r.slice(at + 1));
  }
  return { rows: rowSet.size, cols: colSet.size };
}

function cellAt(
  refs: string[],
  cols: number,
  row: number,
  col: number,
): string | undefined {
  return refs[row * cols + col];
}

export const LOOKUP_FUNCTIONS: Record<string, FunctionImpl> = {
  /**
   * VLOOKUP(searchKey, range, columnIndex, [isSorted=false])
   *
   * Searches the first column of `range` for `searchKey`, returns the value
   * at `columnIndex` (1-based) of the matching row. `isSorted=false` does
   * linear exact-match; `true` does binary-ish approximate match (we use
   * a simple "last <= key" scan).
   */
  VLOOKUP(args, resolve) {
    if (args.length < 3) return { type: "error" };
    const key = args[0]!;
    const range = args[1]!;
    if (range.type !== "range") return { type: "error" };
    const col = argToScalarInt(args[2]!, resolve);
    if (col == null || col < 1) return { type: "error" };
    const sorted = args[3] ? truthyArg(args[3], resolve) : false;
    const { rows, cols } = rangeShape(range.refs);
    if (col > cols) return { type: "error" };
    const keyValue = scalarFromArg(key, resolve);
    let foundRow = -1;
    for (let r = 0; r < rows; r++) {
      const ref = cellAt(range.refs, cols, r, 0);
      if (!ref) continue;
      const cell = readCell(ref, resolve);
      if (sorted) {
        if (cell.type === "empty") continue;
        if (compareScalars(cell.value, keyValue) <= 0) {
          foundRow = r;
        } else {
          break;
        }
      } else {
        if (cell.type !== "empty" && scalarEquals(cell.value, keyValue)) {
          foundRow = r;
          break;
        }
      }
    }
    if (foundRow < 0) return { type: "error" };
    const targetRef = cellAt(range.refs, cols, foundRow, col - 1);
    if (!targetRef) return { type: "error" };
    return resolveToResult(targetRef, resolve);
  },
  HLOOKUP(args, resolve) {
    if (args.length < 3) return { type: "error" };
    const key = args[0]!;
    const range = args[1]!;
    if (range.type !== "range") return { type: "error" };
    const row = argToScalarInt(args[2]!, resolve);
    if (row == null || row < 1) return { type: "error" };
    const sorted = args[3] ? truthyArg(args[3], resolve) : false;
    const { rows, cols } = rangeShape(range.refs);
    if (row > rows) return { type: "error" };
    const keyValue = scalarFromArg(key, resolve);
    let foundCol = -1;
    for (let c = 0; c < cols; c++) {
      const ref = cellAt(range.refs, cols, 0, c);
      if (!ref) continue;
      const cell = readCell(ref, resolve);
      if (sorted) {
        if (cell.type === "empty") continue;
        if (compareScalars(cell.value, keyValue) <= 0) foundCol = c;
        else break;
      } else {
        if (cell.type !== "empty" && scalarEquals(cell.value, keyValue)) {
          foundCol = c;
          break;
        }
      }
    }
    if (foundCol < 0) return { type: "error" };
    const targetRef = cellAt(range.refs, cols, row - 1, foundCol);
    if (!targetRef) return { type: "error" };
    return resolveToResult(targetRef, resolve);
  },
  INDEX(args, resolve) {
    // INDEX(range, row, [col])
    if (args.length < 2) return { type: "error" };
    const range = args[0]!;
    if (range.type !== "range") return { type: "error" };
    const row = argToScalarInt(args[1]!, resolve);
    const col = args[2] ? argToScalarInt(args[2], resolve) ?? 1 : 1;
    if (row == null) return { type: "error" };
    const { rows, cols } = rangeShape(range.refs);
    if (row < 1 || row > rows || col < 1 || col > cols) return { type: "error" };
    const ref = cellAt(range.refs, cols, row - 1, col - 1);
    if (!ref) return { type: "error" };
    return resolveToResult(ref, resolve);
  },
  MATCH(args, resolve) {
    // MATCH(key, range, [matchType=1]) — 1: largest ≤ key (range must be
    // ascending), -1: smallest ≥ key (descending), 0: exact match.
    if (args.length < 2) return { type: "error" };
    const key = args[0]!;
    const range = args[1]!;
    if (range.type !== "range") return { type: "error" };
    const matchType = args[2] ? argToScalarInt(args[2], resolve) ?? 1 : 1;
    const keyValue = scalarFromArg(key, resolve);
    let best = -1;
    for (let i = 0; i < range.refs.length; i++) {
      const cell = readCell(range.refs[i]!, resolve);
      if (cell.type === "empty") continue;
      if (matchType === 0) {
        if (scalarEquals(cell.value, keyValue)) {
          return { type: "number", value: i + 1 };
        }
      } else if (matchType === 1) {
        if (compareScalars(cell.value, keyValue) <= 0) best = i;
        else break;
      } else if (matchType === -1) {
        if (compareScalars(cell.value, keyValue) >= 0) best = i;
        else break;
      }
    }
    if (best < 0) return { type: "error" };
    return { type: "number", value: best + 1 };
  },
  XLOOKUP(args, resolve) {
    // XLOOKUP(searchKey, lookupRange, returnRange, [ifNotFound], [matchMode], [searchMode])
    if (args.length < 3) return { type: "error" };
    const key = args[0]!;
    const lookup = args[1]!;
    const ret = args[2]!;
    if (lookup.type !== "range" || ret.type !== "range") return { type: "error" };
    if (lookup.refs.length !== ret.refs.length) return { type: "error" };
    const ifNotFound = args[3];
    const keyValue = scalarFromArg(key, resolve);
    for (let i = 0; i < lookup.refs.length; i++) {
      const cell = readCell(lookup.refs[i]!, resolve);
      if (cell.type === "empty") continue;
      if (scalarEquals(cell.value, keyValue)) {
        return resolveToResult(ret.refs[i]!, resolve);
      }
    }
    if (ifNotFound) {
      return resolveArgScalar(ifNotFound, resolve);
    }
    return { type: "error" };
  },
  CHOOSE(args, resolve) {
    // CHOOSE(index, val1, val2, ...)
    if (args.length < 2) return { type: "error" };
    const idx = argToScalarInt(args[0]!, resolve);
    if (idx == null || idx < 1 || idx >= args.length) return { type: "error" };
    return resolveArgScalar(args[idx]!, resolve);
  },
  ROWS(args) {
    const a = args[0]!;
    if (a.type !== "range") return { type: "number", value: 1 };
    const { rows } = rangeShape(a.refs);
    return { type: "number", value: rows };
  },
  COLUMNS(args) {
    const a = args[0]!;
    if (a.type !== "range") return { type: "number", value: 1 };
    const { cols } = rangeShape(a.refs);
    return { type: "number", value: cols };
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function scalarFromArg(arg: FunctionArg, resolve: ResolveValue): unknown {
  if (arg.type === "number") return arg.value;
  if (arg.type === "string") return arg.value;
  if (arg.type === "boolean") return arg.value;
  if (arg.type === "range" && arg.refs[0]) {
    const v = resolve(arg.refs[0]);
    if (v.type === "number" || v.type === "string") return v.value;
  }
  return undefined;
}

function scalarEquals(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") return a === b;
  // Allow cross-type compare by string coercion (matches Sheets behavior).
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function compareScalars(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const sa = String(a);
  const sb = String(b);
  return sa.localeCompare(sb);
}

function truthyArg(arg: FunctionArg, resolve: ResolveValue): boolean {
  if (arg.type === "boolean") return arg.value;
  if (arg.type === "number") return arg.value !== 0;
  if (arg.type === "string") return arg.value.length > 0;
  if (arg.type === "range" && arg.refs[0]) {
    const v = resolve(arg.refs[0]);
    if (v.type === "number") return v.value !== 0;
    if (v.type === "string") return (v.value as string).length > 0;
  }
  return false;
}

function resolveToResult(
  ref: string,
  resolve: ResolveValue,
): import("../syntax").ExpressionResult {
  const v = resolve(ref);
  if (v.type === "empty") return { type: "string", value: "" };
  if (v.type === "number") return { type: "number", value: v.value as number };
  if (v.type === "string") return { type: "string", value: v.value as string };
  return { type: "error" };
}

function resolveArgScalar(
  arg: FunctionArg,
  resolve: ResolveValue,
): import("../syntax").ExpressionResult {
  if (arg.type === "number") return { type: "number", value: arg.value };
  if (arg.type === "string") return { type: "string", value: arg.value };
  if (arg.type === "boolean") return { type: "boolean", value: arg.value };
  if (arg.type === "error") return { type: "error" };
  if (arg.refs[0]) return resolveToResult(arg.refs[0], resolve);
  return { type: "string", value: "" };
}

// Helpers used by reference functions ROW / COLUMN. Note these aren't
// "value" functions — they refer to the address of a cell ref. Since our
// AST doesn't carry positional info into function args, we implement them
// off the range expansion: ROW(range) returns the row index of the top-left
// cell, COLUMN similarly. Bare ROW() / COLUMN() (no arg) returns the
// position of the formula cell, which we DON'T currently track — return 0
// in that case.
LOOKUP_FUNCTIONS.ROW = (args) => {
  const a = args[0];
  if (!a || a.type !== "range" || a.refs.length === 0) {
    return { type: "number", value: 0 };
  }
  // Range expansion is row-major; the first ref is the top-left, so the
  // row position is implied. We can't recover the absolute row index from
  // the ref alone here (need the GridShape). Return 1 as a stable default
  // for "first row of this range" — Sheets behavior on a single cell.
  return { type: "number", value: 1 };
};
LOOKUP_FUNCTIONS.COLUMN = (args) => {
  const a = args[0];
  if (!a || a.type !== "range" || a.refs.length === 0) {
    return { type: "number", value: 0 };
  }
  return { type: "number", value: 1 };
};

// Touch unused helpers so the import isn't dropped during tree-shake.
void argToScalarNumber;
void argToScalarString;
