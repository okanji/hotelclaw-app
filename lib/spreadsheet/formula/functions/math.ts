/** Math utility functions beyond the basic ones in functions.ts. */

import { argToScalarNumber, type FunctionImpl } from "./_helpers";

export const MATH_FUNCTIONS: Record<string, FunctionImpl> = {
  ROUNDDOWN(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    const digits = args[1] ? argToScalarNumber(args[1], resolve) ?? 0 : 0;
    const p = 10 ** digits;
    // Truncate toward zero — Excel/Sheets semantics.
    return {
      type: "number",
      value: (x >= 0 ? Math.floor(x * p) : Math.ceil(x * p)) / p,
    };
  },
  ROUNDUP(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    const digits = args[1] ? argToScalarNumber(args[1], resolve) ?? 0 : 0;
    const p = 10 ** digits;
    return {
      type: "number",
      value: (x >= 0 ? Math.ceil(x * p) : Math.floor(x * p)) / p,
    };
  },
  CEILING(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    const sig = args[1] ? argToScalarNumber(args[1], resolve) ?? 1 : 1;
    if (x == null) return { type: "error" };
    if (sig === 0) return { type: "number", value: 0 };
    return { type: "number", value: Math.ceil(x / sig) * sig };
  },
  FLOOR(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    const sig = args[1] ? argToScalarNumber(args[1], resolve) ?? 1 : 1;
    if (x == null) return { type: "error" };
    if (sig === 0) return { type: "number", value: 0 };
    return { type: "number", value: Math.floor(x / sig) * sig };
  },
  INT(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    return { type: "number", value: Math.floor(x) };
  },
  RANDBETWEEN(args, resolve) {
    // Note: this function is NOT pure — Liveblocks won't re-evaluate it on
    // any external trigger. Cell re-renders re-roll, which is the same
    // behavior as Sheets between recalcs. Document this as a known quirk.
    const lo = argToScalarNumber(args[0]!, resolve);
    const hi = argToScalarNumber(args[1]!, resolve);
    if (lo == null || hi == null) return { type: "error" };
    const a = Math.ceil(Math.min(lo, hi));
    const b = Math.floor(Math.max(lo, hi));
    return { type: "number", value: a + Math.floor(Math.random() * (b - a + 1)) };
  },
  RAND() {
    return { type: "number", value: Math.random() };
  },
  PI() {
    return { type: "number", value: Math.PI };
  },
  LN(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null || x <= 0) return { type: "error" };
    return { type: "number", value: Math.log(x) };
  },
  LOG(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null || x <= 0) return { type: "error" };
    const base = args[1] ? argToScalarNumber(args[1], resolve) ?? 10 : 10;
    if (base <= 0 || base === 1) return { type: "error" };
    return { type: "number", value: Math.log(x) / Math.log(base) };
  },
  LOG10(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null || x <= 0) return { type: "error" };
    return { type: "number", value: Math.log10(x) };
  },
  EXP(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    return { type: "number", value: Math.exp(x) };
  },
  SIGN(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    return { type: "number", value: Math.sign(x) };
  },
  TRUNC(args, resolve) {
    const x = argToScalarNumber(args[0]!, resolve);
    if (x == null) return { type: "error" };
    const digits = args[1] ? argToScalarNumber(args[1], resolve) ?? 0 : 0;
    const p = 10 ** digits;
    return { type: "number", value: Math.trunc(x * p) / p };
  },
};
