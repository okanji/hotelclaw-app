/**
 * Date / time functions. We follow Excel's serial-date convention internally:
 * day 0 = 1899-12-30 UTC, day 1 = 1899-12-31, etc. Numbers above ~1e10 are
 * treated as epoch milliseconds (so a cell typed as `Date.now()` still
 * renders sensibly).
 */

import type { ExpressionResult } from "../syntax";
import {
  argToScalarInt,
  argToScalarNumber,
  argToScalarString,
  dateFromSerial,
  serialFromDate,
  type FunctionImpl,
} from "./_helpers";

function coerceDate(value: number): Date {
  if (value > 1e10) return new Date(value); // epoch ms
  return dateFromSerial(value);
}

function dateFromArg(arg: ExpressionResult | undefined): Date | null {
  if (!arg) return null;
  if ("type" in arg && arg.type === "number") return coerceDate(arg.value);
  return null;
}

export const DATE_FUNCTIONS: Record<string, FunctionImpl> = {
  TODAY() {
    const now = new Date();
    const utcDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return { type: "number", value: serialFromDate(new Date(utcDay)) };
  },
  NOW() {
    return { type: "number", value: serialFromDate(new Date()) };
  },
  DATE(args, resolve) {
    const y = argToScalarInt(args[0]!, resolve);
    const m = argToScalarInt(args[1]!, resolve);
    const d = argToScalarInt(args[2]!, resolve);
    if (y == null || m == null || d == null) return { type: "error" };
    const date = new Date(Date.UTC(y, m - 1, d));
    return { type: "number", value: serialFromDate(date) };
  },
  YEAR(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    if (n == null) return { type: "error" };
    return { type: "number", value: coerceDate(n).getUTCFullYear() };
  },
  MONTH(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    if (n == null) return { type: "error" };
    return { type: "number", value: coerceDate(n).getUTCMonth() + 1 };
  },
  DAY(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    if (n == null) return { type: "error" };
    return { type: "number", value: coerceDate(n).getUTCDate() };
  },
  WEEKDAY(args, resolve) {
    // Sheets WEEKDAY(date, [type]) — type 1 = Sun(1)..Sat(7) (default),
    // type 2 = Mon(1)..Sun(7), type 3 = Mon(0)..Sun(6).
    const n = argToScalarNumber(args[0]!, resolve);
    if (n == null) return { type: "error" };
    const dayJs = coerceDate(n).getUTCDay(); // 0 = Sun
    const type = args[1] ? (argToScalarInt(args[1], resolve) ?? 1) : 1;
    let val: number;
    if (type === 1) val = dayJs + 1;
    else if (type === 2) val = ((dayJs + 6) % 7) + 1;
    else if (type === 3) val = (dayJs + 6) % 7;
    else return { type: "error" };
    return { type: "number", value: val };
  },
  EDATE(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    const months = argToScalarInt(args[1]!, resolve);
    if (n == null || months == null) return { type: "error" };
    const d = coerceDate(n);
    const result = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()),
    );
    return { type: "number", value: serialFromDate(result) };
  },
  EOMONTH(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    const months = argToScalarInt(args[1]!, resolve);
    if (n == null || months == null) return { type: "error" };
    const d = coerceDate(n);
    // Day 0 of (month + months + 1) === last day of (month + months).
    const result = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0),
    );
    return { type: "number", value: serialFromDate(result) };
  },
  DATEDIF(args, resolve): ExpressionResult {
    const a = argToScalarNumber(args[0]!, resolve);
    const b = argToScalarNumber(args[1]!, resolve);
    const unit = argToScalarString(args[2]!, resolve).toUpperCase();
    if (a == null || b == null) return { type: "error" };
    const start = coerceDate(a);
    const end = coerceDate(b);
    if (end < start) return { type: "error" };
    const diffMs = end.getTime() - start.getTime();
    switch (unit) {
      case "D":
        return { type: "number", value: Math.floor(diffMs / 86400000) };
      case "M": {
        const months =
          (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
          (end.getUTCMonth() - start.getUTCMonth()) -
          (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
        return { type: "number", value: months };
      }
      case "Y": {
        let years = end.getUTCFullYear() - start.getUTCFullYear();
        if (
          end.getUTCMonth() < start.getUTCMonth() ||
          (end.getUTCMonth() === start.getUTCMonth() &&
            end.getUTCDate() < start.getUTCDate())
        ) {
          years--;
        }
        return { type: "number", value: years };
      }
      default:
        return { type: "error" };
    }
  },
  HOUR(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    if (n == null) return { type: "error" };
    return { type: "number", value: coerceDate(n).getUTCHours() };
  },
  MINUTE(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    if (n == null) return { type: "error" };
    return { type: "number", value: coerceDate(n).getUTCMinutes() };
  },
  SECOND(args, resolve) {
    const n = argToScalarNumber(args[0]!, resolve);
    if (n == null) return { type: "error" };
    return { type: "number", value: coerceDate(n).getUTCSeconds() };
  },
};

// Silence "exported but unused" lint on dateFromArg — kept around for tests.
void dateFromArg;
