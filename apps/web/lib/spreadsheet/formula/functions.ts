import type { ExpressionResult, FunctionArg } from "./syntax";
import { DATE_FUNCTIONS } from "./functions/date";
import { FINANCIAL_FUNCTIONS } from "./functions/financial";
import { LOOKUP_FUNCTIONS } from "./functions/lookup";
import { MATH_FUNCTIONS } from "./functions/math";
import { REGEX_FUNCTIONS } from "./functions/regex";
import { SPARKLINE_FUNCTIONS } from "./functions/sparkline";
import { STATS_FUNCTIONS } from "./functions/stats";
import { STATS2_FUNCTIONS } from "./functions/stats2";
import { TEXT_FUNCTIONS } from "./functions/text";

/**
 * Built-in functions for the formula engine.
 *
 * Type policy:
 *   - Numeric aggregators (SUM, AVERAGE, MIN, MAX, COUNT) coerce each arg's
 *     scalar/range to numbers and **skip non-numeric** values (Google Sheets
 *     behavior). Empty cells are skipped.
 *   - COUNTA counts non-empty cells regardless of type.
 *   - Logical functions (AND, OR, NOT, IF) treat numbers ≠ 0 and non-empty
 *     strings as truthy.
 *   - String functions read scalars; if given a range, they coerce the first
 *     cell (rare case in practice).
 *
 * Returned `ExpressionResult` matches the rest of the evaluator. Errors
 * (division by zero, missing args, bad types) surface as `{ type: "error" }`.
 */

export type ResolveValue = (cellId: string) => {
  type: "number" | "string" | "error" | "empty";
  value: number | string;
};

type FunctionImpl = (
  args: FunctionArg[],
  resolveValue: ResolveValue,
) => ExpressionResult;

/** Iterate every cell value referenced by a `FunctionArg`. */
function* iterateArg(arg: FunctionArg, resolveValue: ResolveValue) {
  switch (arg.type) {
    case "number":
      yield { type: "number" as const, value: arg.value };
      return;
    case "string":
      yield { type: "string" as const, value: arg.value };
      return;
    case "boolean":
      yield { type: "number" as const, value: arg.value ? 1 : 0 };
      return;
    case "error":
      yield { type: "error" as const };
      return;
    case "range":
      for (const ref of arg.refs) {
        const v = resolveValue(ref);
        if (v.type === "empty") continue;
        if (v.type === "number") yield { type: "number" as const, value: v.value as number };
        else if (v.type === "string") yield { type: "string" as const, value: v.value as string };
        else yield { type: "error" as const };
      }
      return;
  }
}

function collectNumbers(
  args: FunctionArg[],
  resolveValue: ResolveValue,
): number[] {
  const out: number[] = [];
  for (const arg of args) {
    for (const v of iterateArg(arg, resolveValue)) {
      if (v.type === "number" && Number.isFinite(v.value)) out.push(v.value);
      // Strings & errors are skipped (Google Sheets behavior).
    }
  }
  return out;
}

function countAll(args: FunctionArg[], resolveValue: ResolveValue): number {
  let n = 0;
  for (const arg of args) {
    for (const v of iterateArg(arg, resolveValue)) {
      if (v.type === "number" || v.type === "string") n++;
    }
  }
  return n;
}

function argToScalarNumber(
  arg: FunctionArg,
  resolveValue: ResolveValue,
): number | null {
  if (arg.type === "number") return arg.value;
  if (arg.type === "boolean") return arg.value ? 1 : 0;
  if (arg.type === "string") {
    const n = Number(arg.value);
    return Number.isFinite(n) ? n : null;
  }
  if (arg.type === "range") {
    const first = arg.refs[0];
    if (!first) return null;
    const v = resolveValue(first);
    if (v.type === "number") return v.value as number;
    if (v.type === "string") {
      const n = Number(v.value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function argToScalarString(
  arg: FunctionArg,
  resolveValue: ResolveValue,
): string {
  if (arg.type === "string") return arg.value;
  if (arg.type === "number") return String(arg.value);
  if (arg.type === "boolean") return arg.value ? "TRUE" : "FALSE";
  if (arg.type === "range") {
    const first = arg.refs[0];
    if (!first) return "";
    const v = resolveValue(first);
    if (v.type === "string") return v.value as string;
    if (v.type === "number") return String(v.value);
  }
  return "";
}

function truthy(arg: FunctionArg, resolveValue: ResolveValue): boolean {
  if (arg.type === "boolean") return arg.value;
  if (arg.type === "number") return arg.value !== 0;
  if (arg.type === "string") return arg.value.length > 0;
  if (arg.type === "range") {
    const first = arg.refs[0];
    if (!first) return false;
    const v = resolveValue(first);
    if (v.type === "number") return v.value !== 0;
    if (v.type === "string") return (v.value as string).length > 0;
  }
  return false;
}

/**
 * Top-level error gate. Aggregators short-circuit when any *direct* arg is
 * an error (e.g. `SUM(Unknown_Named_Range)`). Errors *inside* a range stay
 * silent so partly-populated columns still aggregate cleanly.
 */
function anyTopArgIsError(args: FunctionArg[]): boolean {
  return args.some((a) => a.type === "error");
}

const FUNCTIONS: Record<string, FunctionImpl> = {
  SUM(args, resolve) {
    if (anyTopArgIsError(args)) return { type: "error" };
    const nums = collectNumbers(args, resolve);
    const total = nums.reduce((a, b) => a + b, 0);
    return { type: "number", value: total };
  },
  AVERAGE(args, resolve) {
    if (anyTopArgIsError(args)) return { type: "error" };
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    return {
      type: "number",
      value: nums.reduce((a, b) => a + b, 0) / nums.length,
    };
  },
  COUNT(args, resolve) {
    if (anyTopArgIsError(args)) return { type: "error" };
    return { type: "number", value: collectNumbers(args, resolve).length };
  },
  COUNTA(args, resolve) {
    if (anyTopArgIsError(args)) return { type: "error" };
    return { type: "number", value: countAll(args, resolve) };
  },
  MIN(args, resolve) {
    if (anyTopArgIsError(args)) return { type: "error" };
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    return { type: "number", value: Math.min(...nums) };
  },
  MAX(args, resolve) {
    if (anyTopArgIsError(args)) return { type: "error" };
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    return { type: "number", value: Math.max(...nums) };
  },
  IF(args, resolve) {
    if (args.length < 2) return { type: "error" };
    const cond = truthy(args[0]!, resolve);
    const branch = cond ? args[1]! : (args[2] ?? { type: "string", value: "" });
    if (branch.type === "number") return { type: "number", value: branch.value };
    if (branch.type === "string") return { type: "string", value: branch.value };
    if (branch.type === "boolean") return { type: "boolean", value: branch.value };
    if (branch.type === "range") {
      const first = branch.refs[0];
      if (!first) return { type: "string", value: "" };
      const v = resolve(first);
      if (v.type === "number") return { type: "number", value: v.value as number };
      if (v.type === "string") return { type: "string", value: v.value as string };
    }
    return { type: "error" };
  },
  AND(args, resolve) {
    if (args.length === 0) return { type: "error" };
    return {
      type: "boolean",
      value: args.every((a) => truthy(a, resolve)),
    };
  },
  OR(args, resolve) {
    if (args.length === 0) return { type: "error" };
    return {
      type: "boolean",
      value: args.some((a) => truthy(a, resolve)),
    };
  },
  NOT(args, resolve) {
    if (args.length !== 1) return { type: "error" };
    return { type: "boolean", value: !truthy(args[0]!, resolve) };
  },
  ROUND(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    const digits = args[1] ? (argToScalarNumber(args[1], resolve) ?? 0) : 0;
    const p = 10 ** digits;
    return { type: "number", value: Math.round(x * p) / p };
  },
  ABS(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    return { type: "number", value: Math.abs(x) };
  },
  SQRT(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null || x < 0) return { type: "error" };
    return { type: "number", value: Math.sqrt(x) };
  },
  POWER(args, resolve) {
    const a = argToScalarNumber(args[0]!, resolve);
    const b = argToScalarNumber(args[1]!, resolve);
    if (a == null || b == null) return { type: "error" };
    return { type: "number", value: a ** b };
  },
  MOD(args, resolve) {
    const a = argToScalarNumber(args[0]!, resolve);
    const b = argToScalarNumber(args[1]!, resolve);
    if (a == null || b == null || b === 0) return { type: "error" };
    return { type: "number", value: a % b };
  },
  LEN(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    return { type: "number", value: s.length };
  },
  LOWER(args, resolve) {
    return { type: "string", value: argToScalarString(args[0]!, resolve).toLowerCase() };
  },
  UPPER(args, resolve) {
    return { type: "string", value: argToScalarString(args[0]!, resolve).toUpperCase() };
  },
  CONCAT(args, resolve) {
    let out = "";
    for (const arg of args) {
      if (arg.type === "range") {
        for (const ref of arg.refs) {
          const v = resolve(ref);
          if (v.type === "number") out += String(v.value);
          else if (v.type === "string") out += String(v.value);
        }
      } else {
        out += argToScalarString(arg, resolve);
      }
    }
    return { type: "string", value: out };
  },

  // Logical / error-handling additions (P3.7).
  IFERROR(args, resolve) {
    if (args.length === 0) return { type: "error" };
    const a = args[0]!;
    if (a.type === "error") {
      const fallback = args[1] ?? { type: "string", value: "" };
      return argToResult(fallback, resolve);
    }
    return argToResult(a, resolve);
  },
  IFS(args, resolve) {
    // IFS(cond1, val1, cond2, val2, ...) — first truthy condition wins.
    // No final "else" branch: a fully-false IFS returns #ERR.
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (truthy(args[i]!, resolve)) {
        return argToResult(args[i + 1]!, resolve);
      }
    }
    return { type: "error" };
  },
  SWITCH(args, resolve) {
    // SWITCH(expr, case1, val1, case2, val2, ..., default?)
    // Default exists if there's an odd number of args after `expr`.
    if (args.length < 3) return { type: "error" };
    const subject = args[0]!;
    const subjectVal = scalarValue(subject, resolve);
    let i = 1;
    while (i + 1 < args.length) {
      const caseVal = scalarValue(args[i]!, resolve);
      if (Object.is(caseVal, subjectVal) || String(caseVal) === String(subjectVal)) {
        return argToResult(args[i + 1]!, resolve);
      }
      i += 2;
    }
    if (i < args.length) return argToResult(args[i]!, resolve); // default
    return { type: "error" };
  },
  ISBLANK(args, resolve) {
    if (args.length !== 1) return { type: "error" };
    const a = args[0]!;
    if (a.type === "range") {
      const first = a.refs[0];
      if (!first) return { type: "boolean", value: true };
      const v = resolve(first);
      return { type: "boolean", value: v.type === "empty" };
    }
    if (a.type === "string") return { type: "boolean", value: a.value === "" };
    return { type: "boolean", value: false };
  },
  ISNUMBER(args, resolve) {
    if (args.length !== 1) return { type: "error" };
    const a = args[0]!;
    if (a.type === "number") return { type: "boolean", value: true };
    if (a.type === "range") {
      const first = a.refs[0];
      if (!first) return { type: "boolean", value: false };
      const v = resolve(first);
      return { type: "boolean", value: v.type === "number" };
    }
    return { type: "boolean", value: false };
  },
  ISERROR(args) {
    if (args.length !== 1) return { type: "error" };
    return { type: "boolean", value: args[0]!.type === "error" };
  },
};

// Excel-friendly alias.
FUNCTIONS.CONCATENATE = FUNCTIONS.CONCAT!;

// Merge in the per-domain function modules. Each module's keys are upper-case
// — `getFunction` already upper-cases the lookup, so this is a flat namespace.
Object.assign(
  FUNCTIONS,
  TEXT_FUNCTIONS,
  DATE_FUNCTIONS,
  MATH_FUNCTIONS,
  STATS_FUNCTIONS,
  LOOKUP_FUNCTIONS,
  STATS2_FUNCTIONS,
  FINANCIAL_FUNCTIONS,
  REGEX_FUNCTIONS,
  SPARKLINE_FUNCTIONS,
);

// ── Argument helpers used by the logical/error functions above ──────────────

function argToResult(
  arg: FunctionArg,
  resolve: ResolveValue,
): ExpressionResult {
  if (arg.type === "number") return { type: "number", value: arg.value };
  if (arg.type === "string") return { type: "string", value: arg.value };
  if (arg.type === "boolean") return { type: "boolean", value: arg.value };
  if (arg.type === "error") return { type: "error" };
  // Range: implicit-intersect to first cell.
  const first = arg.refs[0];
  if (!first) return { type: "string", value: "" };
  const v = resolve(first);
  if (v.type === "number") return { type: "number", value: v.value as number };
  if (v.type === "string") return { type: "string", value: v.value as string };
  if (v.type === "error") return { type: "error" };
  return { type: "string", value: "" };
}

/** Coerce a function arg to its scalar primitive for SWITCH equality. */
function scalarValue(arg: FunctionArg, resolve: ResolveValue): unknown {
  if (arg.type === "number") return arg.value;
  if (arg.type === "string") return arg.value;
  if (arg.type === "boolean") return arg.value;
  if (arg.type === "error") return undefined;
  const first = arg.refs[0];
  if (!first) return undefined;
  const v = resolve(first);
  if (v.type === "number") return v.value;
  if (v.type === "string") return v.value;
  return undefined;
}

export function getFunction(name: string): FunctionImpl | undefined {
  return FUNCTIONS[name.toUpperCase()];
}

export function listFunctions(): string[] {
  return Object.keys(FUNCTIONS).sort();
}
