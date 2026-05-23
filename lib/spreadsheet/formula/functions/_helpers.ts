/**
 * Shared utilities for the per-domain function modules. The helpers were
 * originally defined inline in `../functions.ts` for the first 20 functions;
 * they're extracted here so every module (text, date, math, stats, lookup)
 * can reuse them without circular imports.
 *
 * Type policy reminder:
 *   - Numeric aggregators skip non-numeric values (Google Sheets behavior).
 *   - Range args expand to a list of cell ids the caller iterates.
 *   - The `resolve` callback returns `{ type, value }` for a single cell.
 */

import type { ExpressionResult, FunctionArg } from "../syntax";

export type ResolveValue = (cellId: string) => {
  type: "number" | "string" | "error" | "empty";
  value: number | string;
};

export type FunctionImpl = (
  args: FunctionArg[],
  resolveValue: ResolveValue,
) => ExpressionResult;

/** Iterate every concrete value referenced by a function arg. */
export function* iterateArg(arg: FunctionArg, resolveValue: ResolveValue) {
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
        if (v.type === "number")
          yield { type: "number" as const, value: v.value as number };
        else if (v.type === "string")
          yield { type: "string" as const, value: v.value as string };
        else yield { type: "error" as const };
      }
      return;
  }
}

export function collectNumbers(
  args: FunctionArg[],
  resolveValue: ResolveValue,
): number[] {
  const out: number[] = [];
  for (const arg of args) {
    for (const v of iterateArg(arg, resolveValue)) {
      if (v.type === "number" && Number.isFinite(v.value)) out.push(v.value);
    }
  }
  return out;
}

/**
 * Numeric aggregators propagate top-level errors but skip errors inside a
 * range. Returns `true` if any arg is itself an error — callers short-circuit
 * with `{ type: "error" }` when this is true.
 */
export function anyArgIsError(args: FunctionArg[]): boolean {
  return args.some((a) => a.type === "error");
}

export function argToScalarNumber(
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

export function argToScalarInt(
  arg: FunctionArg,
  resolveValue: ResolveValue,
): number | null {
  const n = argToScalarNumber(arg, resolveValue);
  if (n == null) return null;
  return Math.trunc(n);
}

export function argToScalarString(
  arg: FunctionArg,
  resolveValue: ResolveValue,
): string {
  if (arg.type === "string") return arg.value;
  if (arg.type === "number") return formatNumberForString(arg.value);
  if (arg.type === "boolean") return arg.value ? "TRUE" : "FALSE";
  if (arg.type === "range") {
    const first = arg.refs[0];
    if (!first) return "";
    const v = resolveValue(first);
    if (v.type === "string") return v.value as string;
    if (v.type === "number") return formatNumberForString(v.value as number);
  }
  return "";
}

function formatNumberForString(n: number): string {
  // Trim JS noise decimals; matches the cell renderer's behavior.
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
}

/**
 * Excel/Sheets serial date: 1899-12-30 UTC = day 0.
 * Cells holding numeric date values typed by the user get coerced via this.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function dateFromSerial(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC + serial * DAY_MS);
}

export function serialFromDate(date: Date): number {
  return (date.getTime() - EXCEL_EPOCH_UTC) / DAY_MS;
}

/**
 * Match a "criteria" argument against a value. Supports `>`, `>=`, `<`, `<=`,
 * `<>`, equality, and Excel wildcards (`*`, `?`) in string criteria. Used by
 * COUNTIF / SUMIF / AVERAGEIF + the -IFS plurals.
 */
export function criteriaMatches(criteria: string, value: unknown): boolean {
  // Strip outer quotes if any.
  const c = criteria.trim();
  // Operator prefix detection.
  const opMatch = c.match(/^(<=|>=|<>|<|>|=)/);
  const opStr = opMatch?.[1];
  const rest = opStr ? c.slice(opStr.length).trim() : c;
  const op = opStr ?? "=";

  // Try numeric comparison if both sides parse.
  const valueNum = typeof value === "number" ? value : Number(String(value));
  const restNum = Number(rest);
  const bothNumeric =
    Number.isFinite(valueNum) &&
    Number.isFinite(restNum) &&
    String(value).trim() !== "";

  if (bothNumeric) {
    switch (op) {
      case "=":
        return valueNum === restNum;
      case "<>":
        return valueNum !== restNum;
      case "<":
        return valueNum < restNum;
      case "<=":
        return valueNum <= restNum;
      case ">":
        return valueNum > restNum;
      case ">=":
        return valueNum >= restNum;
    }
  }

  // String path. Wildcards: * → .*, ? → .
  const lhs = String(value);
  if (op === "=" || op === "<>") {
    if (rest.includes("*") || rest.includes("?")) {
      const escaped = rest.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      const pattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
      const re = new RegExp(`^${pattern}$`, "i");
      const match = re.test(lhs);
      return op === "=" ? match : !match;
    }
    return op === "="
      ? lhs.toLowerCase() === rest.toLowerCase()
      : lhs.toLowerCase() !== rest.toLowerCase();
  }
  // Inequality on strings — lexicographic
  const cmp = lhs.localeCompare(rest);
  switch (op) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
  }
  return false;
}

/**
 * Return a 1D array of cell values for a range arg, or [arg] for a scalar.
 * Used by COUNTIF / SUMIF / AVERAGEIF — they iterate the criteria range and
 * the sum range in lockstep.
 */
export function rangeValues(
  arg: FunctionArg,
  resolveValue: ResolveValue,
): Array<{ type: "number" | "string" | "empty"; value: unknown }> {
  if (arg.type === "range") {
    return arg.refs.map((ref) => {
      const v = resolveValue(ref);
      if (v.type === "empty") return { type: "empty", value: null };
      if (v.type === "error") return { type: "empty", value: null };
      return { type: v.type, value: v.value };
    });
  }
  if (arg.type === "number") return [{ type: "number", value: arg.value }];
  if (arg.type === "string") return [{ type: "string", value: arg.value }];
  if (arg.type === "boolean")
    return [{ type: "number", value: arg.value ? 1 : 0 }];
  return [];
}
