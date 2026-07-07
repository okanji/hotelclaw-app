import type { WorkflowSpec, StepNode } from "./spec";

/** Escape a step id for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STEP_TEMPLATE_RE = (fromId: string) =>
  new RegExp(`\\{\\{\\s*steps\\.${escapeRegExp(fromId)}([^}]*)\\}\\}`, "g");

/** Rewrite `{{steps.<fromId>…}}` template strings anywhere in a config subtree. */
function rewriteTemplateRefs(value: unknown, fromId: string, toId: string): unknown {
  if (typeof value === "string") {
    return value.replace(STEP_TEMPLATE_RE(fromId), (_match, tail) => `{{steps.${toId}${tail}}}`);
  }
  if (Array.isArray(value)) {
    return value.map((v) => rewriteTemplateRefs(v, fromId, toId));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteTemplateRefs(v, fromId, toId);
    }
    return out;
  }
  return value;
}

/**
 * Rename a step's map key and internal `id`, rewire graph pointers, and update
 * `{{steps.<oldId>…}}` references across the spec.
 */
export function renameStepId(
  spec: WorkflowSpec,
  fromId: string,
  toId: string,
): WorkflowSpec | null {
  if (!fromId || !toId || fromId === toId) return null;
  const step = spec.steps[fromId];
  if (!step || spec.steps[toId]) return null;

  const { [fromId]: _removed, ...rest } = spec.steps;
  const renamed: Record<string, StepNode> = {
    ...rest,
    [toId]: { ...step, id: toId } as StepNode,
  };

  for (const [id, s] of Object.entries(renamed)) {
    const next: Record<string, unknown> = { ...(s as object) };
    if ((next as { next?: string }).next === fromId) next.next = toId;
    if ((next as { on_error?: string }).on_error === `branch:${fromId}`) {
      next.on_error = `branch:${toId}`;
    }
    if (
      "branches" in (next as object) &&
      (next as { branches?: Record<string, string> }).branches
    ) {
      const branches = { ...(next as { branches: Record<string, string> }).branches };
      for (const [k, v] of Object.entries(branches)) {
        if (v === fromId) branches[k] = toId;
      }
      (next as { branches: Record<string, string> }).branches = branches;
    }
    const cfg = (next as { config?: unknown }).config;
    if (cfg !== undefined) {
      (next as { config: unknown }).config = rewriteTemplateRefs(cfg, fromId, toId);
    }
    renamed[id] = next as StepNode;
  }

  const layout = spec.layout ? { ...spec.layout } : undefined;
  if (layout?.[fromId]) {
    layout[toId] = layout[fromId];
    delete layout[fromId];
  }

  let trigger = spec.trigger;
  if (trigger.filter?.expr !== undefined) {
    trigger = {
      ...trigger,
      filter: {
        ...trigger.filter,
        expr: rewriteTemplateRefs(trigger.filter.expr, fromId, toId),
      },
    };
  }

  return {
    ...spec,
    trigger,
    steps: renamed,
    entry_step_id: spec.entry_step_id === fromId ? toId : spec.entry_step_id,
    layout,
  };
}
