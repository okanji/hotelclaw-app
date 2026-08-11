/**
 * ClickUp-style "after submitting → create a task" automation for forms.
 *
 * Pure spec builders + matchers (no "server-only") so tests can validate the
 * emitted specs against lib/workflows/validate without a server context. The
 * per-form settings panel (components/forms/task-automation-card.tsx) manages
 * a REAL workflow through this shape — the same machinery a hand-built
 * automation uses, so everything stays visible and editable in Workflows.
 *
 * The onboarding starter automation (lib/onboarding/automation-specs.ts)
 * emits the same trigger + single create-task shape, so it too shows up as
 * this form's automation in the panel.
 */

export const FORM_AUTOMATION_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type FormAutomationPriority =
  (typeof FORM_AUTOMATION_PRIORITIES)[number];

export type FormTaskAutomationConfig = {
  /** Team (space) the task lands on; null = no team. */
  spaceId: string | null;
  /** Member auto-assigned to each task; null = unassigned. */
  assigneeId: string | null;
  priority: FormAutomationPriority;
};

/** Cap description lines so a 40-question form doesn't emit a novel. */
const MAX_DESCRIPTION_FIELDS = 12;

/**
 * Build the "form submitted → create task" workflow spec. Field references
 * are positional (`trigger.fields.N.formatted` — the convention the trigger
 * payload is built for), resolved against the form's CURRENT field order, so
 * the caller should rebuild the spec whenever the panel is saved.
 */
export function buildFormTaskAutomationSpec(args: {
  formId: string;
  formTitle: string;
  formIcon?: string | null;
  /** Ordered input-field labels from the form's current schema. */
  fieldLabels: string[];
  config: FormTaskAutomationConfig;
}) {
  const icon = args.formIcon?.trim() || "📋";
  const title =
    args.fieldLabels.length > 0
      ? `${icon} ${args.formTitle}: {{trigger.fields.0.formatted}}`
      : `${icon} ${args.formTitle} submission`;
  const lines = args.fieldLabels
    .slice(0, MAX_DESCRIPTION_FIELDS)
    .map((label, i) => `${label}: {{trigger.fields.${i}.formatted}}`);
  const description = [`Submitted via the "${args.formTitle}" form.`, ...lines].join(
    "\n",
  );

  return {
    workflow_spec_version: 1,
    name: `${args.formTitle} submissions become tasks`,
    trigger: {
      event_type: "form.submitted" as const,
      filter: { expr: { "==": [{ var: "trigger.form_id" }, args.formId] } },
    },
    entry_step_id: "create-task",
    steps: {
      "create-task": {
        id: "create-task",
        type: "action.task.create" as const,
        label: "Create task from submission",
        config: {
          title,
          description,
          priority: args.config.priority,
          ...(args.config.spaceId ? { space_id: args.config.spaceId } : {}),
          ...(args.config.assigneeId
            ? { assignee_id: args.config.assigneeId }
            : {}),
        },
      },
    },
  };
}

type LooseSpec = {
  trigger?: { event_type?: string; filter?: unknown };
  steps?: Record<
    string,
    { type?: string; config?: Record<string, unknown> | undefined }
  >;
};

/** Does this workflow spec react to submissions of `formId`? */
export function specTargetsForm(spec: unknown, formId: string): boolean {
  const s = spec as LooseSpec | null;
  if (s?.trigger?.event_type !== "form.submitted") return false;
  // The builder emits the simple `==` equality; hand-edited filters can be
  // arbitrary JSONLogic, so a substring check over the filter is the widest
  // net that never false-negatives on the shapes we emit.
  try {
    return JSON.stringify(s.trigger.filter ?? {}).includes(formId);
  } catch {
    return false;
  }
}

/**
 * When the spec is the simple shape this module emits (single create-task
 * step), extract the panel-editable config. `null` means the workflow was
 * customized in the builder — the panel goes read-only and links there.
 */
export function extractFormTaskAutomationConfig(
  spec: unknown,
): FormTaskAutomationConfig | null {
  const steps = Object.values((spec as LooseSpec | null)?.steps ?? {});
  if (steps.length !== 1 || steps[0]?.type !== "action.task.create") return null;
  const config = steps[0].config ?? {};

  const literalId = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 && !value.includes("{{")
      ? value
      : null;
  const priority = FORM_AUTOMATION_PRIORITIES.includes(
    config.priority as FormAutomationPriority,
  )
    ? (config.priority as FormAutomationPriority)
    : "none";

  return {
    spaceId: literalId(config.space_id),
    assigneeId: literalId(config.assignee_id),
    priority,
  };
}
