import { WorkflowSpec, type StepNode } from "@/lib/workflows/spec";
import { getStep, getTrigger } from "@/lib/workflows/catalog";

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
  }

  // Walk every string in every step's config; extract refs; verify each.
  const declaredVars = new Set(Object.keys(spec.variables ?? {}));
  for (const [stepId, step] of Object.entries(spec.steps)) {
    walkStrings(step.config, (value, path) => {
      let m: RegExpExecArray | null;
      TEMPLATE_RE.lastIndex = 0;
      while ((m = TEMPLATE_RE.exec(value)) !== null) {
        const ref = m[1].trim();
        const reason = validateRef(ref, stepId, upstream, declaredVars);
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

function validateRef(
  ref: string,
  stepId: string,
  upstream: Map<string, Set<string>>,
  declaredVars: Set<string>,
): string | null {
  const head = ref.split(".")[0];
  if (head === "trigger" || head === "context" || head === "now") return null;

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

function buildUpstreamMap(spec: WorkflowSpec): Map<string, Set<string>> {
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

    if (step.next) queue.push({ id: step.next, ancestors: nextAncestors });
    if ("branches" in step && step.branches && typeof step.branches === "object") {
      for (const target of Object.values(step.branches as Record<string, string>)) {
        queue.push({ id: target, ancestors: nextAncestors });
      }
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

// ─── Public API ─────────────────────────────────────────────────────────────

export function validateSpec(input: unknown): ValidationResult {
  const parsed = parseSpec(input);
  if (!parsed.ok) return parsed;
  const spec = input as WorkflowSpec; // safe — parseSpec succeeded
  const issues = [...passCatalog(spec), ...passReferences(spec)];
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
