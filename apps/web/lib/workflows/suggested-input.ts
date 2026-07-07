/** Default `input` template for AI steps, keyed by trigger event type. */

export const TASK_DESCRIPTION_INPUT = {
  path: "trigger.new.description",
  buttonLabel: "Use task description",
} as const;

const TASK_TRIGGER_PREFIX = "task.";

export function isTaskTrigger(eventType: string): boolean {
  return eventType.startsWith(TASK_TRIGGER_PREFIX);
}

/** Suggested one-click input binding when the trigger exposes task payload. */
export function suggestedTriggerInput(
  eventType: string,
): { path: string; buttonLabel: string } | null {
  if (isTaskTrigger(eventType)) return TASK_DESCRIPTION_INPUT;
  return null;
}
