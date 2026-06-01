// Collect and validate dotted paths used in JSONLogic `{ "var": "…" }` nodes
// (branch/filter/trigger predicates). Complements template-string validation in
// validate.ts — same scope rules, different syntax.

import type { WorkflowSpec } from "./spec";
import { buildUpstreamMap } from "./validate";

/** Walk a predicate tree and return every `{ "var": path }` path (deduped). */
export function collectPredicateVarPaths(expr: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  function add(path: string) {
    if (!seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  function walk(node: unknown): void {
    if (node === null || node === undefined) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length !== 1) return;
    const [op, args] = entries[0]!;
    if (op === "var" && typeof args === "string") {
      add(args);
      return;
    }
    if (op === "and" || op === "or") {
      for (const item of args as unknown[]) walk(item);
      return;
    }
    if (op === "not" || op === "!") {
      walk(Array.isArray(args) ? args[0] : args);
      return;
    }
    if (Array.isArray(args)) {
      for (const item of args) walk(item);
    }
  }
  walk(expr);
  return out;
}

export type ValidateScopeRefOptions = {
  /** When false (trigger filters), `steps.*` refs are rejected. */
  allowSteps?: boolean;
};

/**
 * Validate a dotted scope path (no `{{ }}` wrapper).
 * Returns an error message or null if valid.
 */
export function validateScopeRef(
  ref: string,
  stepId: string | null,
  upstream: Map<string, Set<string>>,
  declaredVars: Set<string>,
  options: ValidateScopeRefOptions = {},
): string | null {
  const allowSteps = options.allowSteps !== false;
  const head = ref.split(".")[0];
  if (head === "trigger" || head === "context" || head === "now") return null;

  if (head === "vars") {
    const name = ref.split(".")[1];
    if (!name) return `Variable path is incomplete: ${ref}`;
    if (!declaredVars.has(name)) return `Unknown variable: vars.${name}`;
    return null;
  }

  if (head === "steps") {
    if (!allowSteps) {
      return `Step outputs aren't available in trigger filters — use trigger.* instead (${ref})`;
    }
    if (!stepId) return `Malformed step path: ${ref}`;
    const refStepId = ref.split(".")[1];
    if (!refStepId) return `Malformed step path: ${ref}`;
    if (ref.split(".")[2] !== "output") {
      return `Step paths must look like steps.<id>.output.<field> (${ref})`;
    }
    if (refStepId === stepId) return `This step can't reference its own output (${ref})`;
    const predecessors = upstream.get(stepId) ?? new Set();
    if (!predecessors.has(refStepId)) {
      return `Step "${refStepId}" is not upstream of this step (${ref})`;
    }
    return null;
  }

  return `Unknown path root "${head}" in ${ref} (use trigger.*, steps.*.output.*, vars.*, or context.*)`;
}

export function validatePredicateExpr(
  expr: unknown,
  stepId: string | null,
  spec: WorkflowSpec,
  options: ValidateScopeRefOptions = {},
): string[] {
  const upstream = buildUpstreamMap(spec);
  const declaredVars = new Set(Object.keys(spec.variables ?? {}));
  const errors: string[] = [];
  for (const path of collectPredicateVarPaths(expr)) {
    const reason = validateScopeRef(path, stepId, upstream, declaredVars, options);
    if (reason) errors.push(reason);
  }
  return errors;
}
