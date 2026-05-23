/**
 * Statistical aggregations + the conditional-aggregation family
 * (COUNTIF / SUMIF / AVERAGEIF + their plural -IFS variants).
 *
 * The plural variants pair every "criteria range" with a "criteria"; all
 * criteria must match for a row to count. Implementation iterates the first
 * range, indexes into the others by position.
 */

import {
  argToScalarString,
  collectNumbers,
  criteriaMatches,
  rangeValues,
  type FunctionImpl,
} from "./_helpers";

export const STATS_FUNCTIONS: Record<string, FunctionImpl> = {
  MEDIAN(args, resolve) {
    const nums = collectNumbers(args, resolve).slice().sort((a, b) => a - b);
    if (nums.length === 0) return { type: "error" };
    const mid = nums.length / 2;
    return {
      type: "number",
      value:
        nums.length % 2 === 0
          ? (nums[mid - 1]! + nums[mid]!) / 2
          : nums[Math.floor(mid)]!,
    };
  },
  STDEV(args, resolve) {
    // Sample standard deviation (divides by n-1) — matches Sheets' STDEV.
    const nums = collectNumbers(args, resolve);
    if (nums.length < 2) return { type: "error" };
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance =
      nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (nums.length - 1);
    return { type: "number", value: Math.sqrt(variance) };
  },
  STDEVP(args, resolve) {
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance =
      nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length;
    return { type: "number", value: Math.sqrt(variance) };
  },
  VAR(args, resolve) {
    const nums = collectNumbers(args, resolve);
    if (nums.length < 2) return { type: "error" };
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
      type: "number",
      value:
        nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (nums.length - 1),
    };
  },
  VARP(args, resolve) {
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
      type: "number",
      value: nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length,
    };
  },
  MODE(args, resolve) {
    const nums = collectNumbers(args, resolve);
    if (nums.length === 0) return { type: "error" };
    const counts = new Map<number, number>();
    for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
    let best = nums[0]!;
    let bestCount = 0;
    for (const [n, c] of counts) {
      if (c > bestCount) {
        best = n;
        bestCount = c;
      }
    }
    if (bestCount < 2) return { type: "error" }; // no value repeats
    return { type: "number", value: best };
  },

  // ── Conditional aggregations ─────────────────────────────────────────────
  COUNTIF(args, resolve) {
    if (args.length !== 2) return { type: "error" };
    const range = rangeValues(args[0]!, resolve);
    const criteria = argToScalarString(args[1]!, resolve);
    let count = 0;
    for (const cell of range) {
      if (cell.type === "empty") continue;
      if (criteriaMatches(criteria, cell.value)) count++;
    }
    return { type: "number", value: count };
  },
  SUMIF(args, resolve) {
    // SUMIF(criteriaRange, criteria, [sumRange])
    if (args.length < 2) return { type: "error" };
    const critRange = rangeValues(args[0]!, resolve);
    const criteria = argToScalarString(args[1]!, resolve);
    const sumRange = args[2]
      ? rangeValues(args[2], resolve)
      : critRange;
    let total = 0;
    for (let i = 0; i < critRange.length; i++) {
      const cell = critRange[i]!;
      if (cell.type === "empty") continue;
      if (!criteriaMatches(criteria, cell.value)) continue;
      const s = sumRange[i];
      if (!s || s.type !== "number") continue;
      total += s.value as number;
    }
    return { type: "number", value: total };
  },
  AVERAGEIF(args, resolve) {
    if (args.length < 2) return { type: "error" };
    const critRange = rangeValues(args[0]!, resolve);
    const criteria = argToScalarString(args[1]!, resolve);
    const sumRange = args[2]
      ? rangeValues(args[2], resolve)
      : critRange;
    let total = 0;
    let count = 0;
    for (let i = 0; i < critRange.length; i++) {
      const cell = critRange[i]!;
      if (cell.type === "empty") continue;
      if (!criteriaMatches(criteria, cell.value)) continue;
      const s = sumRange[i];
      if (!s || s.type !== "number") continue;
      total += s.value as number;
      count++;
    }
    if (count === 0) return { type: "error" };
    return { type: "number", value: total / count };
  },
  COUNTIFS(args, resolve) {
    // (range1, crit1, range2, crit2, ...). Same-length ranges required.
    if (args.length < 2 || args.length % 2 !== 0) return { type: "error" };
    const pairs: Array<{ range: ReturnType<typeof rangeValues>; criteria: string }> = [];
    for (let i = 0; i < args.length; i += 2) {
      pairs.push({
        range: rangeValues(args[i]!, resolve),
        criteria: argToScalarString(args[i + 1]!, resolve),
      });
    }
    const len = pairs[0]!.range.length;
    let count = 0;
    for (let i = 0; i < len; i++) {
      let allMatch = true;
      for (const p of pairs) {
        const cell = p.range[i];
        if (!cell || cell.type === "empty" || !criteriaMatches(p.criteria, cell.value)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) count++;
    }
    return { type: "number", value: count };
  },
  SUMIFS(args, resolve) {
    // (sumRange, range1, crit1, range2, crit2, ...)
    if (args.length < 3 || args.length % 2 === 0) return { type: "error" };
    const sumRange = rangeValues(args[0]!, resolve);
    const pairs: Array<{ range: ReturnType<typeof rangeValues>; criteria: string }> = [];
    for (let i = 1; i < args.length; i += 2) {
      pairs.push({
        range: rangeValues(args[i]!, resolve),
        criteria: argToScalarString(args[i + 1]!, resolve),
      });
    }
    let total = 0;
    for (let i = 0; i < sumRange.length; i++) {
      let allMatch = true;
      for (const p of pairs) {
        const cell = p.range[i];
        if (!cell || cell.type === "empty" || !criteriaMatches(p.criteria, cell.value)) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;
      const s = sumRange[i];
      if (s && s.type === "number") total += s.value as number;
    }
    return { type: "number", value: total };
  },
  AVERAGEIFS(args, resolve) {
    if (args.length < 3 || args.length % 2 === 0) return { type: "error" };
    const sumRange = rangeValues(args[0]!, resolve);
    const pairs: Array<{ range: ReturnType<typeof rangeValues>; criteria: string }> = [];
    for (let i = 1; i < args.length; i += 2) {
      pairs.push({
        range: rangeValues(args[i]!, resolve),
        criteria: argToScalarString(args[i + 1]!, resolve),
      });
    }
    let total = 0;
    let count = 0;
    for (let i = 0; i < sumRange.length; i++) {
      let allMatch = true;
      for (const p of pairs) {
        const cell = p.range[i];
        if (!cell || cell.type === "empty" || !criteriaMatches(p.criteria, cell.value)) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;
      const s = sumRange[i];
      if (s && s.type === "number") {
        total += s.value as number;
        count++;
      }
    }
    if (count === 0) return { type: "error" };
    return { type: "number", value: total / count };
  },
};
