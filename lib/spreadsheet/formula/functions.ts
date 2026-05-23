import type { ExpressionResult, FunctionArg } from "./syntax";

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

const FUNCTIONS: Record<string, FunctionImpl> = {
  SUM(args, resolve) {
    const nums = collectNumbers(args, resolve);
    const total = nums.reduce((a, b) => a + b, 0);
    return { type: "number", value: total };
  },
  AVERAGE(args, resolve) {
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    return {
      type: "number",
      value: nums.reduce((a, b) => a + b, 0) / nums.length,
    };
  },
  COUNT(args, resolve) {
    return { type: "number", value: collectNumbers(args, resolve).length };
  },
  COUNTA(args, resolve) {
    return { type: "number", value: countAll(args, resolve) };
  },
  MIN(args, resolve) {
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    return { type: "number", value: Math.min(...nums) };
  },
  MAX(args, resolve) {
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
};

// Excel-friendly alias.
FUNCTIONS.CONCATENATE = FUNCTIONS.CONCAT!;

export function getFunction(name: string): FunctionImpl | undefined {
  return FUNCTIONS[name.toUpperCase()];
}

export function listFunctions(): string[] {
  return Object.keys(FUNCTIONS).sort();
}
