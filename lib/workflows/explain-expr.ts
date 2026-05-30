// Render a JSONLogic predicate — the subset our evaluator supports
// (see lib/workflows/predicate.ts) — as a short, human-readable phrase.
//
// One shared serializer so the branch/filter card subtitle, the lane headers,
// and the inspector "reads as" line are all driven from the same place and can
// never drift. Anything we don't recognise degrades gracefully to "a
// condition" rather than throwing.
//
//   { "==": [{var:"trigger.new.priority"}, "urgent"] }  → "priority is urgent"
//   { "and": [a, b] }                                   → "<a> and <b>"
//   { "not": {var:"trigger.new.assignee_id"} }          → "assignee_id is empty"

const OP_PHRASES: Record<string, string> = {
  "==": "is",
  "!=": "is not",
  ">": "is greater than",
  ">=": "is at least",
  "<": "is less than",
  "<=": "is at most",
  in: "is any of",
};

/** Human phrase for a predicate, e.g. "priority is urgent". */
export function explainCondition(expr: unknown): string {
  if (expr === undefined || expr === null) return "a condition";
  return renderNode(expr) ?? "a condition";
}

/**
 * Strip the namespace plumbing from a dotted ref so it reads naturally on a
 * card: "trigger.new.priority" → "priority", "steps.classify.output.label" →
 * "label", "vars.threshold" → "threshold". Falls back to the raw path.
 */
export function humanizeRef(path: string): string {
  const clean = path.replace(/[{}]/g, "").trim();
  if (!clean) return path;
  const parts = clean.split(".").filter(Boolean);
  while (parts.length > 1 && (parts.at(-1) === "output" || parts.at(-1) === "new")) {
    parts.pop();
  }
  return parts.at(-1) ?? clean;
}

function renderNode(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object") return formatLiteral(node);

  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [op, args] = entries[0]!;

  if (op === "var") return humanizeRef(String(args));

  if (op === "and" || op === "or") {
    const parts = (Array.isArray(args) ? args : [])
      .map(renderNode)
      .filter((p): p is string => Boolean(p));
    if (parts.length === 0) return null;
    return parts.join(op === "and" ? " and " : " or ");
  }

  // Unary "is empty / falsy" — { "not": {var} } or legacy { "!": [{var}] }.
  if (op === "!" || op === "not") {
    const inner = Array.isArray(args) ? args[0] : args;
    const ref = readVarRef(inner);
    if (ref) return `${humanizeRef(ref)} is empty`;
    const rendered = renderNode(inner);
    return rendered ? `not (${rendered})` : null;
  }

  if (op in OP_PHRASES && Array.isArray(args) && args.length === 2) {
    const [a, b] = args;
    const left = readVarRef(a) ? humanizeRef(readVarRef(a)!) : formatSide(a);
    // { "!=": [{var}, ""] } is our "is not empty" encoding — read it that way.
    if (op === "!=" && b === "") return `${left} is not empty`;
    const right = formatSide(b);
    return `${left} ${OP_PHRASES[op]} ${right}`;
  }

  return null;
}

function readVarRef(v: unknown): string | null {
  if (
    v &&
    typeof v === "object" &&
    "var" in (v as object) &&
    typeof (v as { var: unknown }).var === "string"
  ) {
    return (v as { var: string }).var;
  }
  return null;
}

function formatSide(v: unknown): string {
  const ref = readVarRef(v);
  if (ref) return humanizeRef(ref);
  return formatLiteral(v);
}

function formatLiteral(v: unknown): string {
  if (v === null || v === undefined) return "nothing";
  if (typeof v === "string") return v === "" ? "empty" : `“${v}”`;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(formatLiteral).join(" or ");
  return JSON.stringify(v);
}
