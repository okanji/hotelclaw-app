/**
 * SPARKLINE(range, [options]) — returns a sentinel-prefixed string that the
 * cell renderer detects and draws as an inline SVG.
 *
 * Sentinel encoding: `__SPARKLINE__:<type>:<comma-sep-numbers>` (with
 * optional color appended as `:<hex>`). Keeping it in the existing
 * string-result lane avoids extending the `ExpressionResult` union.
 *
 * Supported types: `line`, `column`, `bar`, `winloss`.
 * Options arg (rarely used in practice) is a string like
 * `"line"` or `"column,red"`. We parse leniently.
 */

import {
  argToScalarString,
  type FunctionImpl,
  type ResolveValue,
} from "./_helpers";
import type { FunctionArg } from "../syntax";

export const SPARKLINE_FUNCTIONS: Record<string, FunctionImpl> = {
  SPARKLINE(args, resolve) {
    if (args.length === 0) return { type: "error" };
    const nums = collectSparklineNumbers(args[0]!, resolve);
    if (nums.length === 0) return { type: "string", value: "" };
    let kind = "line";
    let color = "#0ea5e9";
    if (args[1]) {
      const opts = argToScalarString(args[1], resolve).toLowerCase();
      const parts = opts.split(/[,;]/).map((p) => p.trim());
      for (const p of parts) {
        if (p === "line" || p === "column" || p === "bar" || p === "winloss") {
          kind = p;
        } else if (/^#?[0-9a-f]{3,8}$/.test(p)) {
          color = p.startsWith("#") ? p : `#${p}`;
        }
      }
    }
    return {
      type: "string",
      value: `__SPARKLINE__:${kind}:${nums.join(",")}:${color}`,
    };
  },
};

function collectSparklineNumbers(
  arg: FunctionArg,
  resolve: ResolveValue,
): number[] {
  const out: number[] = [];
  if (arg.type === "range") {
    for (const ref of arg.refs) {
      const v = resolve(ref);
      if (v.type === "number") out.push(v.value as number);
      else if (v.type === "string") {
        const n = Number(v.value);
        if (Number.isFinite(n)) out.push(n);
      }
    }
  } else if (arg.type === "number") {
    out.push(arg.value);
  }
  return out;
}
