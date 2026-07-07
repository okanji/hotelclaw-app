/** Second-tier statistical functions — correlation, percentiles, rank. */

import {
  argToScalarNumber,
  collectNumbers,
  type FunctionImpl,
} from "./_helpers";

export const STATS2_FUNCTIONS: Record<string, FunctionImpl> = {
  CORREL(args, resolve) {
    // Two parallel ranges → Pearson correlation.
    if (args.length !== 2) return { type: "error" };
    const xs = collectNumbers([args[0]!], resolve);
    const ys = collectNumbers([args[1]!], resolve);
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return { type: "error" };
    const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i]! - mx;
      const dy = ys[i]! - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    if (dx2 === 0 || dy2 === 0) return { type: "error" };
    return { type: "number", value: num / Math.sqrt(dx2 * dy2) };
  },
  PERCENTILE(args, resolve) {
    const nums = collectNumbers([args[0]!], resolve);
    if (nums.length === 0) return { type: "error" };
    const p = argToScalarNumber(args[1]!, resolve);
    if (p == null || p < 0 || p > 1) return { type: "error" };
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted.length === 1) return { type: "number", value: sorted[0]! };
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return { type: "number", value: sorted[lo]! };
    const frac = idx - lo;
    return {
      type: "number",
      value: sorted[lo]! * (1 - frac) + sorted[hi]! * frac,
    };
  },
  QUARTILE(args, resolve) {
    const nums = collectNumbers([args[0]!], resolve);
    if (nums.length === 0) return { type: "error" };
    const q = argToScalarNumber(args[1]!, resolve);
    if (q == null || q < 0 || q > 4) return { type: "error" };
    const sorted = [...nums].sort((a, b) => a - b);
    const idx = (q / 4) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return { type: "number", value: sorted[lo]! };
    const frac = idx - lo;
    return {
      type: "number",
      value: sorted[lo]! * (1 - frac) + sorted[hi]! * frac,
    };
  },
  RANK(args, resolve) {
    // RANK(value, range, [ascending=false])
    const value = argToScalarNumber(args[0]!, resolve);
    if (value == null) return { type: "error" };
    const nums = collectNumbers([args[1]!], resolve);
    if (nums.length === 0) return { type: "error" };
    const asc = args[2] ? !!argToScalarNumber(args[2], resolve) : false;
    let rank = 1;
    for (const n of nums) {
      if (asc ? n < value : n > value) rank++;
    }
    return { type: "number", value: rank };
  },
};
