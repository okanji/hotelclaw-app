// Variable resolution for the workflow runtime. Walks the step config and
// replaces every {{path.through.scope}} template string with the corresponding
// scope value. Mirrors validate.ts pass 3 — but here we actually substitute
// instead of just checking shape.
//
// Strings that consist of exactly one {{...}} expression and nothing else are
// replaced with the raw scope value (preserving its type — number, object,
// array). Strings containing other text around the ref are stringified.

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const FULL_TEMPLATE_RE = /^\{\{\s*([^}]+?)\s*\}\}$/;

export type ResolutionScope = {
  trigger?: Record<string, unknown>;
  steps?: Record<string, { output?: unknown }>;
  vars?: Record<string, unknown>;
  context?: Record<string, unknown>;
  /** Role-based org refs (D1): {{org.lead.<team name>}} / {{org.title.<job
   *  title>}} → the CURRENT holder's user id, resolved at run time. */
  org?: { lead: Record<string, string>; title: Record<string, string> };
};

export function resolveValue(input: unknown, scope: ResolutionScope): unknown {
  if (typeof input === "string") return resolveString(input, scope);
  if (Array.isArray(input)) return input.map((v) => resolveValue(v, scope));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = resolveValue(v, scope);
    }
    return out;
  }
  return input;
}

function resolveString(str: string, scope: ResolutionScope): unknown {
  // Pure single-ref string — return the raw value (preserve type).
  const exact = FULL_TEMPLATE_RE.exec(str);
  if (exact) return lookup(exact[1].trim(), scope);

  // Mixed string — substitute each ref, stringify each value.
  return str.replace(TEMPLATE_RE, (_match, ref) => {
    const value = lookup(String(ref).trim(), scope);
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function lookup(ref: string, scope: ResolutionScope): unknown {
  const parts = ref.split(".");
  const head = parts[0];

  if (head === "now") return new Date().toISOString();

  // Org refs: the key is everything after the kind, joined back (team names
  // may contain dots) and lowercased to match buildOrgScope's keys.
  if (head === "org") {
    const kind = parts[1];
    const key = parts.slice(2).join(".").trim().toLowerCase();
    if (!scope.org || !key) return undefined;
    if (kind === "lead") return scope.org.lead[key];
    if (kind === "title") return scope.org.title[key];
    return undefined;
  }

  let cursor: unknown;
  if (head === "trigger") cursor = scope.trigger;
  else if (head === "steps") cursor = scope.steps;
  else if (head === "vars") cursor = scope.vars;
  else if (head === "context") cursor = scope.context;
  else return undefined;

  for (let i = 1; i < parts.length; i++) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[parts[i]];
  }
  return cursor;
}
