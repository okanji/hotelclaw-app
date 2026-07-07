// JSONLogic-style predicate evaluator for workflow filter / branch_if /
// trigger.filter.
//
//   { "==":  [a, b] }        equality          { "!=": [a, b] } inequality
//   { "===": [a, b] }        strict equality    { "!==": [a, b] } strict ineq
//   { ">":   [a, b] }, ">=" "<", "<="           (2-arg, or 3-arg "between")
//   { "in":  [needle, hay] } needle in haystack (array or string)
//   { "and": [...] }, "or"   logical            { "not"/"!": expr } { "!!": expr }
//   { "if":  [cond, then, else, ...] }          { "cat": [...] } string concat
//   { "+"/"-"/"*"/"/"/"%": [a, b, ...] }        arithmetic
//   { "min"/"max": [...] }
//   { "var": "trigger.x.y" } lookup in scope via dotted path
//   primitives (string|number|boolean|null) — return themselves
//
// IMPORTANT: this evaluator must NEVER throw. The condition builder degrades any
// predicate it can't model into a read-only "Custom condition" that the user can
// still save, so the runtime can be handed an operator this evaluator doesn't
// know. Throwing here would crash dispatch/filter with no run row (the dispatcher
// catches it as an opaque "runtime_error"). Instead we log and treat an unknown
// or malformed node as `undefined` — which evaluatePredicate coerces to `false`,
// a defined, safe outcome (filter stops, branch takes the else path, trigger
// doesn't fire) rather than a crash.

import type { ResolutionScope } from "@/lib/workflows/resolve";

export function evaluatePredicate(expr: unknown, scope: ResolutionScope): boolean {
  try {
    return Boolean(evalNode(expr, scope));
  } catch (err) {
    // Defense in depth — evalNode is written not to throw, but a malformed
    // structure (e.g. a non-array passed where args are spread) could still
    // bubble. Fail closed rather than crashing the run.
    console.warn("[predicate] evaluation failed, treating as false:", err);
    return false;
  }
}

function evalNode(node: unknown, scope: ResolutionScope): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => evalNode(n, scope));

  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    console.warn(`[predicate] expected single-key op, got ${keys.length} keys — treating as false`);
    return undefined;
  }
  const op = keys[0];
  const args = obj[op];
  // Lazily evaluate the (array) args only for ops that consume resolved values,
  // so logical/conditional ops below keep their short-circuit semantics.
  let _list: unknown[] | null = null;
  const list = () =>
    (_list ??= Array.isArray(args) ? args.map((a) => evalNode(a, scope)) : [evalNode(args, scope)]);
  const num = (v: unknown) => Number(v);

  switch (op) {
    case "var":
      return varLookup(String(args), scope);
    case "==":
      return list()[0] == list()[1];
    case "!=":
      return list()[0] != list()[1];
    case "===":
      return list()[0] === list()[1];
    case "!==":
      return list()[0] !== list()[1];
    case ">":
    case ">=":
    case "<":
    case "<=": {
      // 2-arg comparison, or 3-arg "between" (a < b < c) per JSONLogic. compare()
      // is numeric- and date-aware so ISO-date fields (due_at, fired_at) order
      // chronologically instead of coercing to NaN and always being false.
      const vals = list();
      const test = (x: unknown, y: unknown) => {
        const c = compare(x, y);
        if (c === null) return false;
        if (op === ">") return c > 0;
        if (op === ">=") return c >= 0;
        if (op === "<") return c < 0;
        return c <= 0;
      };
      if (vals.length >= 3) return test(vals[0], vals[1]) && test(vals[1], vals[2]);
      return test(vals[0], vals[1]);
    }
    case "in": {
      const [n, h] = list();
      if (Array.isArray(h)) return h.includes(n);
      if (typeof h === "string") return h.includes(String(n));
      return false;
    }
    case "contains":
      return String(list()[0] ?? "").includes(String(list()[1] ?? ""));
    case "starts_with":
      return String(list()[0] ?? "").startsWith(String(list()[1] ?? ""));
    case "ends_with":
      return String(list()[0] ?? "").endsWith(String(list()[1] ?? ""));
    case "and":
      // Evaluate lazily so a short-circuit avoids touching later (possibly
      // expensive/undefined) branches; JSONLogic returns the last truthy/first
      // falsy value, but we only need a boolean here.
      return (args as unknown[]).every((a) => Boolean(evalNode(a, scope)));
    case "or":
      return (args as unknown[]).some((a) => Boolean(evalNode(a, scope)));
    case "not":
    case "!":
      return !evalNode(Array.isArray(args) ? args[0] : args, scope);
    case "!!":
      return Boolean(evalNode(Array.isArray(args) ? args[0] : args, scope));
    case "if":
    case "?:": {
      // [cond, then, else] with optional elseif chaining.
      const a = args as unknown[];
      for (let i = 0; i + 1 < a.length; i += 2) {
        if (Boolean(evalNode(a[i], scope))) return evalNode(a[i + 1], scope);
      }
      return a.length % 2 === 1 ? evalNode(a[a.length - 1], scope) : undefined;
    }
    case "cat":
      return list().map((v) => (v === null || v === undefined ? "" : String(v))).join("");
    case "+":
      return list().reduce((acc: number, v) => acc + num(v), 0);
    case "*":
      return list().reduce((acc: number, v) => acc * num(v), 1);
    case "-": {
      const v = list();
      return v.length === 1 ? -num(v[0]) : num(v[0]) - num(v[1]);
    }
    case "/":
      return num(list()[0]) / num(list()[1]);
    case "%":
      return num(list()[0]) % num(list()[1]);
    case "min":
      return Math.min(...list().map(num));
    case "max":
      return Math.max(...list().map(num));
    default:
      console.warn(`[predicate] unknown operator "${op}" — treating as false`);
      return undefined;
  }
}

// Order two values for </<=/>/>=. Returns negative/zero/positive like a
// comparator, or null when they aren't meaningfully comparable (so the operator
// yields false rather than a misleading NaN result). Prefers numeric ordering,
// then chronological (ISO dates / parseable date strings).
function compare(a: unknown, b: unknown): number | null {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (typeof a === "string" && typeof b === "string") {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0; // lexicographic fallback
  }
  return null;
}

function varLookup(path: string, scope: ResolutionScope): unknown {
  const parts = path.split(".");
  const head = parts[0];
  let cursor: unknown;
  if (head === "trigger") cursor = scope.trigger;
  else if (head === "steps") cursor = scope.steps;
  else if (head === "vars") cursor = scope.vars;
  else if (head === "context") cursor = scope.context;
  else return undefined;
  for (let i = 1; i < parts.length; i++) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[parts[i]];
  }
  return cursor;
}
