import { getStep, getTrigger } from "@/lib/workflows/catalog";
import type { StepType, TriggerEventType } from "@/lib/workflows/spec";

// One-line answers to "what does this workflow do?" for list rows, template
// cards and run logs — Linear's loop cards read "Trigger → Action", and that
// pair is the whole story for most automations. Pure + client-safe; labels come
// from the catalog so they match the builder's vocabulary.

/** Triggers that need no event to fire, so "Run now" can stand in for them. */
export const RUN_NOW_TRIGGERS: ReadonlySet<string> = new Set([
  "manual.run",
  "schedule.cron",
  "schedule.at_time",
]);

export function canRunNow(triggerType: string | null | undefined): boolean {
  return !!triggerType && RUN_NOW_TRIGGERS.has(triggerType);
}

/** Catalog label for a trigger id ("When a task is created"), raw id fallback. */
export function triggerLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return getTrigger(type as TriggerEventType)?.label ?? type;
}

/**
 * The step a reader would name as the outcome: the first real action (not
 * control flow — a filter or a delay is plumbing, not what the workflow
 * does). `more` counts the other distinct actions.
 */
export function primaryAction(
  stepTypes: readonly string[],
): { label: string; more: number } | null {
  const actions = stepTypes.filter((t) => !t.startsWith("control."));
  if (actions.length === 0) return null;
  const label = getStep(actions[0] as StepType)?.label ?? actions[0];
  return { label, more: actions.length - 1 };
}

/** Run status → sentence-case label ("succeeded" → "Succeeded"). */
export function runStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}
