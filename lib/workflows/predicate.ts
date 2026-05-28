// Minimal JSONLogic-style predicate evaluator for workflow filter / branch_if /
// trigger.filter. Supports the operators we care about for v1 — keep small,
// add only when a real workflow needs more.
//
//   { "==":  [a, b] }        equality
//   { "!=":  [a, b] }        inequality
//   { ">":   [a, b] }, ">=" "<", "<="
//   { "in":  [needle, hay] } needle in haystack (array or string)
//   { "and": [...] }, "or"   logical
//   { "not": expr }
//   { "var": "trigger.x.y" } lookup in scope via dotted path
//   primitives (string|number|boolean|null) — return themselves

import type { ResolutionScope } from "@/lib/workflows/resolve";

export function evaluatePredicate(expr: unknown, scope: ResolutionScope): boolean {
  return Boolean(evalNode(expr, scope));
}

function evalNode(node: unknown, scope: ResolutionScope): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => evalNode(n, scope));

  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new Error(`predicate: expected single-key op, got ${keys.length} keys`);
  }
  const op = keys[0];
  const args = obj[op];

  switch (op) {
    case "var":
      return varLookup(String(args), scope);
    case "==": {
      const [a, b] = args as [unknown, unknown];
      return evalNode(a, scope) == evalNode(b, scope);
    }
    case "!=": {
      const [a, b] = args as [unknown, unknown];
      return evalNode(a, scope) != evalNode(b, scope);
    }
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const [a, b] = args as [unknown, unknown];
      const av = Number(evalNode(a, scope));
      const bv = Number(evalNode(b, scope));
      if (op === ">") return av > bv;
      if (op === ">=") return av >= bv;
      if (op === "<") return av < bv;
      return av <= bv;
    }
    case "in": {
      const [needle, hay] = args as [unknown, unknown];
      const n = evalNode(needle, scope);
      const h = evalNode(hay, scope);
      if (Array.isArray(h)) return h.includes(n);
      if (typeof h === "string") return h.includes(String(n));
      return false;
    }
    case "and":
      return (args as unknown[]).every((a) => Boolean(evalNode(a, scope)));
    case "or":
      return (args as unknown[]).some((a) => Boolean(evalNode(a, scope)));
    case "not":
      return !evalNode(args, scope);
    default:
      throw new Error(`predicate: unknown operator "${op}"`);
  }
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
