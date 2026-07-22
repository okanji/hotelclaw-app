import { WorkflowSpec, type StepNode } from "@/lib/workflows/spec";
import { getStep, getTrigger } from "@/lib/workflows/catalog";
import { validatePredicateExpr } from "@/lib/workflows/predicate-vars";

// Three-pass validation. Returns a flat issue list rather than throwing so the
// canvas can render them inline next to the relevant step.

export interface ValidationIssue {
  path: string; // dotted path inside the spec, e.g. "steps.summarize.config.input"
  severity: "error" | "warning";
  message: string;
  step_id?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

// ─── Pass 1: Zod parse ──────────────────────────────────────────────────────

export function parseSpec(input: unknown): ValidationResult {
  const parsed = WorkflowSpec.safeParse(input);
  if (parsed.success) return { ok: true, issues: [] };
  const issues: ValidationIssue[] = parsed.error.issues.map((iss) => ({
    path: iss.path.join("."),
    severity: "error",
    message: iss.message,
  }));
  return { ok: false, issues };
}

// ─── Pass 2: catalog validation ─────────────────────────────────────────────

function passCatalog(spec: WorkflowSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const triggerEntry = getTrigger(spec.trigger.event_type);
  if (!triggerEntry) {
    issues.push({
      path: "trigger.event_type",
      severity: "error",
      message: `Unknown trigger event_type: ${spec.trigger.event_type}`,
    });
  }

  for (const [stepId, step] of Object.entries(spec.steps)) {
    const entry = getStep(step.type);
    if (!entry) {
      issues.push({
        path: `steps.${stepId}.type`,
        severity: "error",
        message: `Unknown step type: ${step.type}`,
        step_id: stepId,
      });
    }
  }

  if (!spec.steps[spec.entry_step_id]) {
    issues.push({
      path: "entry_step_id",
      severity: "error",
      message: `entry_step_id "${spec.entry_step_id}" does not match any step`,
    });
  }

  return issues;
}

// ─── Pass 3: reference validation ───────────────────────────────────────────

/**
 * Walk every string-valued config field and surface dangling {{...}} refs.
 *
 * A ref is valid if it points at:
 *   - `trigger.*` (any path under the trigger's outputSchema; we don't deep-check
 *     paths into payload because outputSchemas are intentionally loose)
 *   - `steps.<id>.output.*` where <id> is an upstream step (reachable from
 *     entry_step_id without going through this step)
 *   - `vars.<name>` where <name> is declared in spec.variables
 *   - `context.property_id` | `context.user_id` | `context.now`
 */
function passReferences(spec: WorkflowSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Build the predecessor set for each step (best-effort topological — handles
  // straight chains + branches; ignores loop/parallel edges, accepting some
  // false-negative-ref-validity for v1 simplicity).
  const upstream = buildUpstreamMap(spec);

  // 'next'/branches references must point at real step ids.
  for (const [stepId, step] of Object.entries(spec.steps)) {
    if (step.next && !spec.steps[step.next]) {
      issues.push({
        path: `steps.${stepId}.next`,
        severity: "error",
        message: `next "${step.next}" does not match any step`,
        step_id: stepId,
      });
    }
    if ("branches" in step && step.branches && typeof step.branches === "object") {
      for (const [branchKey, target] of Object.entries(step.branches as Record<string, string>)) {
        if (!spec.steps[target]) {
          issues.push({
            path: `steps.${stepId}.branches.${branchKey}`,
            severity: "error",
            message: `branch target "${target}" does not match any step`,
            step_id: stepId,
          });
        }
      }
    }
    // Control-flow targets that live in config, not in `next`/`branches`.
    if (step.type === "control.foreach") {
      const bs = (step.config as { body_start?: string }).body_start;
      if (bs && !spec.steps[bs]) {
        issues.push({
          path: `steps.${stepId}.config.body_start`,
          severity: "error",
          message: `loop body "${bs}" does not match any step`,
          step_id: stepId,
        });
      }
    }
    if (step.type === "control.parallel") {
      const branches = (step.config as { branches?: string[] }).branches ?? [];
      branches.forEach((target, i) => {
        if (!spec.steps[target]) {
          issues.push({
            path: `steps.${stepId}.config.branches.${i}`,
            severity: "error",
            message: `parallel branch "${target}" does not match any step`,
            step_id: stepId,
          });
        }
      });
    }
    const onError = (step as { on_error?: string }).on_error;
    if (typeof onError === "string" && onError.startsWith("branch:")) {
      const target = onError.slice("branch:".length);
      if (!spec.steps[target]) {
        issues.push({
          path: `steps.${stepId}.on_error`,
          severity: "error",
          message: `on-error target "${target}" does not match any step`,
          step_id: stepId,
        });
      }
    }
  }

  // Walk every string in every step's config; extract refs; verify each. Steps
  // inside a foreach body may also reference the loop's item var (vars.<item>).
  const declaredVars = new Set(Object.keys(spec.variables ?? {}));
  for (const [stepId, step] of Object.entries(spec.steps)) {
    const loopVars = loopItemVarsFor(spec, stepId);
    const stepVars = loopVars.length ? new Set([...declaredVars, ...loopVars]) : declaredVars;
    walkStrings(step.config, (value, path) => {
      let m: RegExpExecArray | null;
      TEMPLATE_RE.lastIndex = 0;
      while ((m = TEMPLATE_RE.exec(value)) !== null) {
        const ref = m[1].trim();
        const reason = validateRef(ref, stepId, upstream, stepVars);
        if (reason) {
          issues.push({
            path: `steps.${stepId}.config.${path}`,
            severity: "error",
            message: reason,
            step_id: stepId,
          });
        }
      }
    });
  }

  return issues;
}

// ─── Pass 4: predicate `var` paths + step id consistency ─────────────────────

function passPredicates(spec: WorkflowSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (spec.trigger.filter?.expr !== undefined) {
    for (const message of validatePredicateExpr(spec.trigger.filter.expr, null, spec, {
      allowSteps: false,
    })) {
      issues.push({
        path: "trigger.filter.expr",
        severity: "error",
        message,
      });
    }
  }

  for (const [stepId, step] of Object.entries(spec.steps)) {
    if (step.id !== stepId) {
      issues.push({
        path: `steps.${stepId}.id`,
        severity: "warning",
        message: `Step id "${step.id}" doesn't match its key "${stepId}" — rename it in Advanced or references may break`,
        step_id: stepId,
      });
    }

    const cfg = (step as { config?: { expr?: unknown } }).config;
    const expr = cfg?.expr;
    if (expr === undefined) {
      if (step.type === "control.branch_if") {
        issues.push({
          path: `steps.${stepId}.config.expr`,
          severity: "warning",
          message: "No condition set — this branch will always take the false path",
          step_id: stepId,
        });
      } else if (step.type === "control.filter") {
        issues.push({
          path: `steps.${stepId}.config.expr`,
          severity: "warning",
          message: "No condition set — this filter will always stop the workflow here",
          step_id: stepId,
        });
      }
      continue;
    }

    for (const message of validatePredicateExpr(expr, stepId, spec)) {
      issues.push({
        path: `steps.${stepId}.config.expr`,
        severity: "error",
        message,
        step_id: stepId,
      });
    }
  }

  return issues;
}

function validateRef(
  ref: string,
  stepId: string,
  upstream: Map<string, Set<string>>,
  declaredVars: Set<string>,
): string | null {
  const head = ref.split(".")[0];
  if (head === "trigger" || head === "context" || head === "now" || head === "org") return null;

  if (head === "vars") {
    const name = ref.split(".")[1];
    if (!name) return `vars ref missing a name: {{${ref}}}`;
    if (!declaredVars.has(name)) return `Unknown variable: vars.${name}`;
    return null;
  }

  if (head === "steps") {
    const refStepId = ref.split(".")[1];
    if (!refStepId) return `Malformed step ref: {{${ref}}}`;
    if (refStepId === stepId) return `Self-reference is not allowed: {{${ref}}}`;
    const predecessors = upstream.get(stepId) ?? new Set();
    if (!predecessors.has(refStepId)) {
      return `Step "${refStepId}" is not upstream of "${stepId}"`;
    }
    return null;
  }

  return `Unknown root in ref: {{${ref}}} (expected trigger|steps|vars|context|now)`;
}

// Every outgoing step-id edge from a step: `next`, branch targets, the foreach
// loop body, parallel branch starts, and an on_error 'branch:' target. Used by
// the upstream map, dangling-target checks, and reachability so all of them
// agree on the graph shape (previously the upstream BFS ignored loop/parallel
// edges, wrongly reporting "not upstream" for valid loop-body refs).
function stepEdges(step: StepNode): string[] {
  const s = step as {
    next?: string;
    branches?: Record<string, string>;
    config?: Record<string, unknown>;
    on_error?: string;
  };
  const out: string[] = [];
  if (s.next) out.push(s.next);
  if (s.branches) out.push(...Object.values(s.branches));
  if (step.type === "control.foreach") {
    const bs = (s.config as { body_start?: string } | undefined)?.body_start;
    if (bs) out.push(bs);
  }
  if (step.type === "control.parallel") {
    const br = (s.config as { branches?: string[] } | undefined)?.branches;
    if (Array.isArray(br)) out.push(...br);
  }
  if (typeof s.on_error === "string" && s.on_error.startsWith("branch:")) {
    out.push(s.on_error.slice("branch:".length));
  }
  return out;
}

// All steps reachable from `startId` following every edge kind.
function reachableSet(spec: WorkflowSpec, startId: string | undefined): Set<string> {
  const out = new Set<string>();
  const stack = startId ? [startId] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || !spec.steps[id]) continue;
    out.add(id);
    for (const t of stepEdges(spec.steps[id])) stack.push(t);
  }
  return out;
}

/**
 * Item-variable names in scope for a step because it sits inside one (or more,
 * if nested) foreach loop bodies. The runtime exposes the current item as
 * `vars.<item_var>`, so these become valid refs for steps in the body.
 */
export function loopItemVarsFor(spec: WorkflowSpec, stepId: string): string[] {
  const vars: string[] = [];
  for (const step of Object.values(spec.steps)) {
    if (step.type !== "control.foreach") continue;
    const cfg = step.config as { body_start?: string; item_var?: string };
    if (!cfg.body_start) continue;
    if (reachableSet(spec, cfg.body_start).has(stepId)) vars.push(cfg.item_var || "item");
  }
  return vars;
}

export function buildUpstreamMap(spec: WorkflowSpec): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const id of Object.keys(spec.steps)) result.set(id, new Set());

  // BFS from entry, accumulating ancestors.
  const queue: Array<{ id: string; ancestors: Set<string> }> = [
    { id: spec.entry_step_id, ancestors: new Set() },
  ];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { id, ancestors } = queue.shift()!;
    const step = spec.steps[id];
    if (!step) continue;
    // Cycle protection: only revisit if we have new ancestors to merge.
    const current = result.get(id) ?? new Set();
    const before = current.size;
    for (const a of ancestors) current.add(a);
    result.set(id, current);
    const visitKey = id + "|" + current.size;
    if (current.size === before && seen.has(visitKey)) continue;
    seen.add(visitKey);

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);

    for (const target of stepEdges(step)) {
      queue.push({ id: target, ancestors: nextAncestors });
    }
  }

  return result;
}

function walkStrings(
  obj: unknown,
  visit: (value: string, path: string) => void,
  prefix = "",
): void {
  if (typeof obj === "string") {
    visit(obj, prefix);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkStrings(item, visit, prefix ? `${prefix}.${i}` : String(i)));
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      walkStrings(v, visit, prefix ? `${prefix}.${k}` : k);
    }
  }
}

// ─── Pass 5: reachability (orphans + cycles) ────────────────────────────────
// Warnings, not errors — a disconnected or looping step shouldn't block save,
// but the user should know part of their flow won't run as they expect.
function passReachability(spec: WorkflowSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Reachable set from the entry, following every edge kind.
  const reachable = new Set<string>();
  const stack = [spec.entry_step_id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id) || !spec.steps[id]) continue;
    reachable.add(id);
    for (const t of stepEdges(spec.steps[id])) stack.push(t);
  }

  for (const id of Object.keys(spec.steps)) {
    if (!reachable.has(id)) {
      issues.push({
        path: `steps.${id}`,
        severity: "warning",
        message:
          "This step isn't connected to the workflow — nothing reaches it, so it never runs.",
        step_id: id,
      });
    }
  }

  // Cycle detection (DFS over the edge graph). A back-edge means a step can run
  // repeatedly without a loop construct — usually an accidental mis-wire.
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  let cycleStep: string | null = null;
  const visit = (id: string) => {
    if (cycleStep || !spec.steps[id]) return;
    color.set(id, GRAY);
    for (const t of stepEdges(spec.steps[id])) {
      const c = color.get(t);
      if (c === GRAY) {
        cycleStep = t;
        return;
      }
      if (c === undefined) visit(t);
      if (cycleStep) return;
    }
    color.set(id, BLACK);
  };
  visit(spec.entry_step_id);
  if (cycleStep) {
    issues.push({
      path: `steps.${cycleStep}`,
      severity: "warning",
      message:
        "This step is part of a loop in the workflow — it can run over and over. If that isn't intended, check the connections.",
      step_id: cycleStep,
    });
  }

  return issues;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function validateSpec(input: unknown): ValidationResult {
  const parsed = parseSpec(input);
  if (!parsed.ok) return parsed;
  const spec = input as WorkflowSpec; // safe — parseSpec succeeded
  const issues = [
    ...passCatalog(spec),
    ...passReferences(spec),
    ...passPredicates(spec),
    ...passReachability(spec),
  ];
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

/**
 * Cheaper helper used by the executor at runtime — assumes the spec is already
 * Zod-valid, just resolves catalog membership for one step.
 */
export function lookupStep(step: StepNode) {
  const entry = getStep(step.type);
  if (!entry) {
    throw new Error(`[workflows] step type ${step.type} not in catalog`);
  }
  return entry;
}
