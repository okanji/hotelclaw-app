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
  | "contains"
  | "starts_with"
  | "ends_with"
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
  { id: "==", label: "is", types: ["string", "number", "boolean", "date", "json"] },
  { id: "!=", label: "is not", types: ["string", "number", "boolean", "date", "json"] },
  { id: "contains", label: "contains", types: ["string"] },
  { id: "starts_with", label: "starts with", types: ["string"] },
  { id: "ends_with", label: "ends with", types: ["string"] },
  { id: "is_any_of", label: "is any of", types: ["string", "string[]"] },
  { id: ">", label: "is greater than", types: ["number", "date"] },
  { id: ">=", label: "is at least", types: ["number", "date"] },
  { id: "<", label: "is less than", types: ["number", "date"] },
  { id: "<=", label: "is at most", types: ["number", "date"] },
  {
    id: "empty",
    label: "is empty",
    types: ["string", "number", "boolean", "string[]", "date", "json"],
  },
  {
    id: "not_empty",
    label: "is not empty",
    types: ["string", "number", "boolean", "string[]", "date", "json"],
  },
];

// Date fields read more naturally with chronological labels than numeric ones.
const DATE_OP_LABELS: Partial<Record<ClauseOp, string>> = {
  "==": "is on",
  "!=": "is not on",
  ">": "is after",
  ">=": "is on or after",
  "<": "is before",
  "<=": "is on or before",
};

export function opsForType(type: RefType): OpDef[] {
  const ops = CLAUSE_OPS.filter((o) => o.types.includes(type));
  if (type === "date") {
    return ops.map((o) => (DATE_OP_LABELS[o.id] ? { ...o, label: DATE_OP_LABELS[o.id]! } : o));
  }
  return ops;
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

  // { contains|starts_with|ends_with: [{var}, "text"] } — substring tests.
  if (
    (op === "contains" || op === "starts_with" || op === "ends_with") &&
    Array.isArray(args) &&
    args.length === 2
  ) {
    const path = readVar(args[0]);
    if (path && (typeof args[1] === "string" || typeof args[1] === "number")) {
      return { path, op, value: String(args[1]), values: [], type: "string" };
    }
    return null;
  }

  if (op === "in" && Array.isArray(args) && args.length === 2) {
    // { in: [{var}, [a,b,c]] } — scalar field is one of a list
    const pathLeft = readVar(args[0]);
    const arrRight = args[1];
    if (pathLeft && Array.isArray(arrRight)) {
      return {
        path: pathLeft,
        op: "is_any_of",
        value: "",
        values: arrRight.map(String),
        type: "string",
      };
    }
    // { in: ["guest-complaint", {var: "trigger.added_labels"}] } — needle in array field
    const pathRight = readVar(args[1]);
    const needle = args[0];
    if (pathRight && (typeof needle === "string" || typeof needle === "number")) {
      return {
        path: pathRight,
        op: "is_any_of",
        value: "",
        values: [String(needle)],
        type: "string[]",
      };
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
    case "contains":
      return { contains: [v, c.value] };
    case "starts_with":
      return { starts_with: [v, c.value] };
    case "ends_with":
      return { ends_with: [v, c.value] };
    case "is_any_of": {
      const list = c.values.map((x) => x.trim()).filter(Boolean);
      if (list.length === 0) return null;
      // Array trigger fields (e.g. added_labels): needle ∈ haystack.
      if (c.type === "string[]") {
        if (list.length === 1) return { in: [list[0], v] };
        return {
          or: list.map((needle) => ({ in: [needle, v] })),
        };
      }
      // Scalar fields: value ∈ allowed list.
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
  // Dates stay as the entered ISO string; predicate.ts compares them
  // chronologically via Date.parse.
  return raw;
}
