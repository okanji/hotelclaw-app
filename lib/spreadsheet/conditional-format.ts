/**
 * Conditional formatting evaluator. Pure function — takes a sheet's
 * rules + cell values + the per-cell evaluated results, returns a map of
 * cellId → effective format patch.
 *
 * The surface merges `cell.format` with the patch from this evaluator:
 * `effectiveFormat = { ...cell.format, ...rulePatch }`. Rule order is
 * insertion order in the LiveMap; the first matching rule wins (last-write
 * does NOT win — Sheets uses first-rule-wins, and that's what fits the
 * "set up a rule, see results" mental model).
 *
 * Color scale rules compute a per-cell gradient color and patch `bgColor`.
 * All other condition kinds patch whatever fields are in `rule.format`.
 */

import type {
  CellFormat,
  ConditionalRule,
  ConditionalRuleCondition,
} from "@/liveblocks.config";
import type { ExpressionResult, GridShape } from "./formula";
import { evaluateExpression } from "./formula";

export function evaluateConditionalFormats(
  rules: Iterable<ConditionalRule>,
  shape: GridShape,
  cellValues: Map<string, string>,
  cellGraph: Map<string, ExpressionResult>,
): Map<string, Partial<CellFormat>> {
  const out = new Map<string, Partial<CellFormat>>();

  for (const rule of rules) {
    const inRange = expandRangeToCells(rule.range, shape);
    if (inRange.length === 0) continue;

    // Color-scale needs the min/max of the range's numeric values up-front.
    if (rule.condition.kind === "colorScale") {
      const nums: number[] = [];
      for (const cid of inRange) {
        const r = cellGraph.get(cid);
        if (r?.type === "number") nums.push(r.value);
      }
      if (nums.length === 0) continue;
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      const { minColor, midColor, maxColor } = rule.condition;
      for (const cid of inRange) {
        const r = cellGraph.get(cid);
        if (r?.type !== "number") continue;
        const t = hi === lo ? 0.5 : (r.value - lo) / (hi - lo);
        const color = midColor
          ? t < 0.5
            ? interpolateColor(minColor, midColor, t * 2)
            : interpolateColor(midColor, maxColor, (t - 0.5) * 2)
          : interpolateColor(minColor, maxColor, t);
        // Don't overwrite a prior rule's bgColor on the same cell.
        if (!out.has(cid)) out.set(cid, { bgColor: color });
      }
      continue;
    }

    for (const cid of inRange) {
      if (out.has(cid)) continue; // first rule wins
      const evaluated = cellGraph.get(cid);
      const rawValue = cellValues.get(cid) ?? "";
      if (matches(rule.condition, evaluated, rawValue, cid, shape, cellGraph)) {
        out.set(cid, { ...rule.format });
      }
    }
  }

  return out;
}

function matches(
  condition: ConditionalRuleCondition,
  evaluated: ExpressionResult | undefined,
  rawValue: string,
  cellId: string,
  shape: GridShape,
  cellGraph: Map<string, ExpressionResult>,
): boolean {
  switch (condition.kind) {
    case "cellIs": {
      const n = evaluated?.type === "number" ? evaluated.value : Number(rawValue);
      const v = Number(condition.value);
      const v2 = Number(condition.value2 ?? 0);
      if (Number.isNaN(n) || Number.isNaN(v)) return false;
      switch (condition.op) {
        case "eq":
          return n === v;
        case "neq":
          return n !== v;
        case "lt":
          return n < v;
        case "lte":
          return n <= v;
        case "gt":
          return n > v;
        case "gte":
          return n >= v;
        case "between":
          return n >= Math.min(v, v2) && n <= Math.max(v, v2);
      }
      return false;
    }
    case "textContains": {
      const s = evaluated?.type === "string" ? evaluated.value : rawValue;
      return s.toLowerCase().includes(condition.value.toLowerCase());
    }
    case "isEmpty":
      return !evaluated || evaluated.type === "string" && evaluated.value === "";
    case "isNotEmpty":
      return !!evaluated && !(evaluated.type === "string" && evaluated.value === "");
    case "isError":
      return evaluated?.type === "error";
    case "formula": {
      // Evaluate the formula in the cell's context. The `cellId` is
      // substituted as the implicit subject — we replace `$cell` with the
      // cell's value before evaluation.
      try {
        const r = evaluateExpression(condition.expression, shape, (refId) => {
          const v = cellGraph.get(refId);
          if (!v) return { type: "empty", value: 0 };
          if (v.type === "number") return { type: "number", value: v.value };
          if (v.type === "string") return { type: "string", value: v.value };
          return { type: "empty", value: 0 };
        });
        if (r.type === "boolean") return r.value;
        if (r.type === "number") return r.value !== 0;
        if (r.type === "string") return r.value.length > 0;
        return false;
      } catch {
        return false;
      }
    }
    case "colorScale":
      return false; // handled in caller
  }
}

function expandRangeToCells(
  range: { startRef: string; endRef: string },
  shape: GridShape,
): string[] {
  const split = (ref: string): { x: number; y: number } | null => {
    const at = ref.indexOf("@");
    if (at <= 0) return null;
    const x = shape.columnIds.indexOf(ref.slice(0, at));
    const y = shape.rowIds.indexOf(ref.slice(at + 1));
    if (x < 0 || y < 0) return null;
    return { x, y };
  };
  const s = split(range.startRef);
  const e = split(range.endRef);
  if (!s || !e) return [];
  const minX = Math.min(s.x, e.x);
  const maxX = Math.max(s.x, e.x);
  const minY = Math.min(s.y, e.y);
  const maxY = Math.max(s.y, e.y);
  const out: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const c = shape.columnIds[x];
      const r = shape.rowIds[y];
      if (c && r) out.push(`${c}@${r}`);
    }
  }
  return out;
}

/**
 * Linear interpolate between two hex colors. Tolerates `#rgb`, `#rrggbb`,
 * and CSS color names by falling back to mid-point of #000000 / #ffffff
 * when parsing fails — color-scale rules degrade gracefully on bad input.
 */
function interpolateColor(a: string, b: string, t: number): string {
  const ca = parseHex(a) ?? [0, 0, 0];
  const cb = parseHex(b) ?? [255, 255, 255];
  const r = Math.round(ca[0]! + (cb[0]! - ca[0]!) * t);
  const g = Math.round(ca[1]! + (cb[1]! - ca[1]!) * t);
  const bl = Math.round(ca[2]! + (cb[2]! - ca[2]!) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function parseHex(c: string): [number, number, number] | null {
  let h = c.startsWith("#") ? c.slice(1) : c;
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
