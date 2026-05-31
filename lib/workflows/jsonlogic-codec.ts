// Bidirectional codec between a flat, editable condition model (ALL/ANY of N
// rows) and the JSONLogic our evaluator runs (predicate.ts). The condition
// builder edits the model; we serialize to JSONLogic on every change and parse
// existing JSONLogic back into the model when a step is opened.
//
// IMPORTANT — every operator we emit must be one predicate.ts actually
// supports: var, ==, !=, >, >=, <, <=, in, and, or, not. (It does NOT support
// the unary "!", so "is empty" emits {not: {var}} and "is not empty" emits
// {"!=": [{var}, ""]}.) Anything we can't represent as a flat ALL/ANY of rows
// returns null from parse → the builder falls back to raw-JSON mode so nothing
// is ever lost.

import type { RefType } from "./refs";

export type ClauseOp =
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "is_any_of"
  | "empty"
  | "not_empty";

export interface Clause {
  path: string;
  op: ClauseOp;
  /** Scalar text value (for ==, !=, >, …). Ignored by empty/not_empty/is_any_of. */
  value: string;
  /** Options for is_any_of. */
  values: string[];
  /** Coarse type of the chosen field — drives the value widget + coercion. */
  type: RefType;
}

export interface ConditionModel {
  combine: "all" | "any";
  clauses: Clause[];
}

export interface OpDef {
  id: ClauseOp;
  label: string;
  /** Which field types this operator is offered for. */
  types: RefType[];
}

// Operator menu, ordered. Filtered per field type at render time.
export const CLAUSE_OPS: OpDef[] = [
  { id: "==", label: "is", types: ["string", "number", "boolean", "json"] },
  { id: "!=", label: "is not", types: ["string", "number", "boolean", "json"] },
  { id: "is_any_of", label: "is any of", types: ["string", "string[]"] },
  { id: ">", label: "is greater than", types: ["number"] },
  { id: ">=", label: "is at least", types: ["number"] },
  { id: "<", label: "is less than", types: ["number"] },
  { id: "<=", label: "is at most", types: ["number"] },
  { id: "empty", label: "is empty", types: ["string", "number", "boolean", "string[]", "json"] },
  {
    id: "not_empty",
    label: "is not empty",
    types: ["string", "number", "boolean", "string[]", "json"],
  },
];

export function opsForType(type: RefType): OpDef[] {
  return CLAUSE_OPS.filter((o) => o.types.includes(type));
}

export function emptyClause(path = "", type: RefType = "string"): Clause {
  return { path, op: "==", value: "", values: [], type };
}

// ─── Parse: JSONLogic → model (null if not representable) ────────────────────

export function parseCondition(expr: unknown): ConditionModel | null {
  if (expr === undefined || expr === null) return { combine: "all", clauses: [] };
  if (typeof expr !== "object") return null;
  const entries = Object.entries(expr as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [op, args] = entries[0]!;

  if ((op === "and" || op === "or") && Array.isArray(args)) {
    const clauses: Clause[] = [];
    for (const node of args) {
      const c = parseClause(node);
      if (!c) return null;
      clauses.push(c);
    }
    return { combine: op === "and" ? "all" : "any", clauses };
  }

  const single = parseClause(expr);
  return single ? { combine: "all", clauses: [single] } : null;
}

function parseClause(node: unknown): Clause | null {
  if (!node || typeof node !== "object") return null;
  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [op, args] = entries[0]!;

  // A bare {var} is a JS-truthiness test — {var:0} and {var:""} are both
  // falsy. Our flat model can't express that: the closest, "is not empty"
  // ({"!=":[v,""]}), evaluates 0 as true, so adopting it would silently change
  // the predicate's meaning. Decline instead and let the builder keep the raw
  // JSONLogic in JSON mode, lossless.
  if (op === "var") {
    return null;
  }

  // {not: {var}} or legacy {"!": [{var}]} → "is empty".
  if (op === "not" || op === "!") {
    const inner = Array.isArray(args) ? args[0] : args;
    const path = readVar(inner);
    if (path) return { path, op: "empty", value: "", values: [], type: "string" };
    return null;
  }

  if (op === "in" && Array.isArray(args) && args.length === 2) {
    const path = readVar(args[0]);
    const arr = args[1];
    if (path && Array.isArray(arr)) {
      return { path, op: "is_any_of", value: "", values: arr.map(String), type: "string" };
    }
    return null;
  }

  if (
    (op === "==" || op === "!=" || op === ">" || op === ">=" || op === "<" || op === "<=") &&
    Array.isArray(args) &&
    args.length === 2
  ) {
    const path = readVar(args[0]);
    if (!path) return null;
    // {"!=": [{var}, ""]} is our "is not empty" encoding.
    if (op === "!=" && args[1] === "") {
      return { path, op: "not_empty", value: "", values: [], type: "string" };
    }
    return {
      path,
      op,
      value: scalarToString(args[1]),
      values: [],
      type: inferType(args[1]),
    };
  }

  return null;
}

// ─── Serialize: model → JSONLogic (undefined if no usable clauses) ───────────

export function serializeCondition(model: ConditionModel): unknown | undefined {
  const nodes = model.clauses.map(serializeClause).filter((n): n is object => n !== null);
  if (nodes.length === 0) return undefined;
  // One clause needs no and/or wrapper — but only ALL emits the bare node.
  // If the user explicitly chose ANY we still wrap ({or:[node]}) so the choice
  // round-trips back to "any" instead of silently resetting to "all".
  if (nodes.length === 1 && model.combine === "all") return nodes[0];
  return { [model.combine === "all" ? "and" : "or"]: nodes };
}

function serializeClause(c: Clause): object | null {
  if (!c.path) return null;
  const v = { var: c.path };
  switch (c.op) {
    case "empty":
      return { not: v };
    case "not_empty":
      return { "!=": [v, ""] };
    case "is_any_of": {
      const list = c.values.map((x) => x.trim()).filter(Boolean);
      if (list.length === 0) return null;
      return { in: [v, list] };
    }
    default:
      return { [c.op]: [v, coerce(c.value, c.type)] };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function readVar(v: unknown): string | null {
  if (v && typeof v === "object" && "var" in (v as object)) {
    const path = (v as { var: unknown }).var;
    if (typeof path === "string") return path;
  }
  return null;
}

function scalarToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function inferType(v: unknown): RefType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

/** Coerce the typed-in string to a real value, driven by the field type. */
function coerce(raw: string, type: RefType): unknown {
  if (type === "number") {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) ? n : raw;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}
