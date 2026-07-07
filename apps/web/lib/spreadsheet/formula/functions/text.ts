/**
 * Text / string functions. All take string scalars (with `argToScalarString`
 * coercion) and return strings or numbers. Indices in Excel/Sheets are
 * 1-based — we honor that even though it requires `- 1` at every entry.
 */

import type { ExpressionResult } from "../syntax";
import {
  argToScalarInt,
  argToScalarNumber,
  argToScalarString,
  type FunctionImpl,
} from "./_helpers";

export const TEXT_FUNCTIONS: Record<string, FunctionImpl> = {
  LEFT(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    const n = args[1] ? argToScalarInt(args[1], resolve) ?? 1 : 1;
    return { type: "string", value: s.slice(0, Math.max(0, n)) };
  },
  RIGHT(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    const n = args[1] ? argToScalarInt(args[1], resolve) ?? 1 : 1;
    return { type: "string", value: n <= 0 ? "" : s.slice(-n) };
  },
  MID(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    const start = (argToScalarInt(args[1]!, resolve) ?? 1) - 1;
    const n = argToScalarInt(args[2]!, resolve) ?? 0;
    if (start < 0 || n <= 0) return { type: "string", value: "" };
    return { type: "string", value: s.slice(start, start + n) };
  },
  TRIM(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    // Sheets-style: collapse internal whitespace runs to one space too.
    return { type: "string", value: s.trim().replace(/\s+/g, " ") };
  },
  SUBSTITUTE(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    const find = argToScalarString(args[1]!, resolve);
    const replace = argToScalarString(args[2]!, resolve);
    const occurrence = args[3]
      ? argToScalarInt(args[3], resolve) ?? 0
      : 0;
    if (find === "") return { type: "string", value: s };
    if (occurrence === 0) {
      return { type: "string", value: s.split(find).join(replace) };
    }
    // Replace only the Nth occurrence (1-based).
    let i = -1;
    for (let k = 0; k < occurrence; k++) {
      i = s.indexOf(find, i + 1);
      if (i === -1) return { type: "string", value: s };
    }
    return {
      type: "string",
      value: s.slice(0, i) + replace + s.slice(i + find.length),
    };
  },
  REPLACE(args, resolve) {
    // REPLACE(text, start, length, newText) — position-based, 1-indexed.
    const s = argToScalarString(args[0]!, resolve);
    const start = (argToScalarInt(args[1]!, resolve) ?? 1) - 1;
    const length = argToScalarInt(args[2]!, resolve) ?? 0;
    const repl = argToScalarString(args[3]!, resolve);
    if (start < 0) return { type: "error" };
    return {
      type: "string",
      value: s.slice(0, start) + repl + s.slice(start + Math.max(0, length)),
    };
  },
  FIND(args, resolve) {
    // Case-SENSITIVE substring search (1-indexed). #ERR if not found.
    const find = argToScalarString(args[0]!, resolve);
    const within = argToScalarString(args[1]!, resolve);
    const start = args[2]
      ? (argToScalarInt(args[2], resolve) ?? 1) - 1
      : 0;
    const idx = within.indexOf(find, Math.max(0, start));
    if (idx === -1) return { type: "error" };
    return { type: "number", value: idx + 1 };
  },
  SEARCH(args, resolve) {
    // Case-INSENSITIVE substring search.
    const find = argToScalarString(args[0]!, resolve).toLowerCase();
    const within = argToScalarString(args[1]!, resolve).toLowerCase();
    const start = args[2]
      ? (argToScalarInt(args[2], resolve) ?? 1) - 1
      : 0;
    const idx = within.indexOf(find, Math.max(0, start));
    if (idx === -1) return { type: "error" };
    return { type: "number", value: idx + 1 };
  },
  PROPER(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    return {
      type: "string",
      value: s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
    };
  },
  REPT(args, resolve) {
    const s = argToScalarString(args[0]!, resolve);
    const n = argToScalarInt(args[1]!, resolve) ?? 0;
    if (n < 0 || n > 1000) return { type: "error" };
    return { type: "string", value: s.repeat(n) };
  },
  TEXT(args, resolve): ExpressionResult {
    // TEXT(value, format_text). Minimal format-string interpreter for the
    // common cases — `0`, `0.00`, `#,##0`, `0%`, `$#,##0.00`, `yyyy-mm-dd`.
    const value = argToScalarNumber(args[0]!, resolve);
    if (value == null) {
      return { type: "string", value: argToScalarString(args[0]!, resolve) };
    }
    const fmt = argToScalarString(args[1]!, resolve);
    return { type: "string", value: applyTextFormat(value, fmt) };
  },
  VALUE(args, resolve): ExpressionResult {
    const s = argToScalarString(args[0]!, resolve).trim();
    // Strip common currency / percent / comma noise.
    let cleaned = s.replace(/[, $]/g, "");
    let multiplier = 1;
    if (cleaned.endsWith("%")) {
      multiplier = 0.01;
      cleaned = cleaned.slice(0, -1);
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { type: "error" };
    return { type: "number", value: n * multiplier };
  },
  NUMBERVALUE(args, resolve): ExpressionResult {
    const s = argToScalarString(args[0]!, resolve).trim();
    const decimal = args[1]
      ? argToScalarString(args[1], resolve)
      : ".";
    const group = args[2]
      ? argToScalarString(args[2], resolve)
      : ",";
    let cleaned = s;
    if (group) cleaned = cleaned.split(group).join("");
    if (decimal !== ".") cleaned = cleaned.replace(decimal, ".");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { type: "error" };
    return { type: "number", value: n };
  },
};

/**
 * Tiny TEXT() format interpreter. Handles `0`, `#`, `,`, `.`, `%`, `$`,
 * plus the date tokens `yyyy mm dd hh MM ss`. Order matters in the regex.
 */
function applyTextFormat(value: number, fmt: string): string {
  // Date tokens — if any are present, treat the value as an Excel serial.
  if (/[yMdhms]/.test(fmt)) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + value * 86400000);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const h = date.getUTCHours();
    const mi = date.getUTCMinutes();
    const se = date.getUTCSeconds();
    return fmt
      .replace(/yyyy/g, String(y))
      .replace(/yy/g, String(y).slice(-2))
      .replace(/mm/g, String(mo).padStart(2, "0"))
      .replace(/m/g, String(mo))
      .replace(/dd/g, String(d).padStart(2, "0"))
      .replace(/d/g, String(d))
      .replace(/hh/g, String(h).padStart(2, "0"))
      .replace(/h/g, String(h))
      .replace(/MM/g, String(mi).padStart(2, "0"))
      .replace(/ss/g, String(se).padStart(2, "0"));
  }

  // Numeric format.
  let v = value;
  const isPercent = fmt.includes("%");
  if (isPercent) v *= 100;
  const hasCurrency = fmt.includes("$");
  const hasComma = /,#|,0/.test(fmt);
  const decMatch = fmt.match(/\.([0#]+)/);
  const decimals = decMatch ? decMatch[1]!.length : 0;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  let body: string;
  if (hasComma) {
    body = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(abs);
  } else {
    body = abs.toFixed(decimals);
  }
  return `${sign}${hasCurrency ? "$" : ""}${body}${isPercent ? "%" : ""}`;
}
