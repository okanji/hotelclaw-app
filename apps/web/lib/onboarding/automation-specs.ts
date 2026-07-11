/**
 * Pure spec builders for onboarding-seeded automations. Plain module (no
 * "server-only") so tests can validate the emitted specs against
 * lib/workflows/validate without a server context.
 */

/** "Maintenance form submitted → create a task" — the canonical starter
 *  automation. Trigger filters on the exact form id this onboarding created;
 *  the task lands on the maintenance team's board when one exists. */
export function buildMaintenanceAutomationSpec(args: {
  formId: string;
  formTitle: string;
  spaceId: string | null;
}) {
  return {
    workflow_spec_version: 1,
    name: "Maintenance requests become tasks",
    trigger: {
      event_type: "form.submitted" as const,
      filter: { expr: { "==": [{ var: "trigger.form_id" }, args.formId] } },
    },
    entry_step_id: "create-task",
    steps: {
      "create-task": {
        id: "create-task",
        type: "action.task.create" as const,
        label: "Create maintenance task",
        config: {
          // fields.0 = the form's first field (Location on the generated
          // maintenance form); formatted is the human-readable value.
          title: "🔧 Maintenance: {{trigger.fields.0.formatted}}",
          description:
            `Submitted via the "${args.formTitle}" form. ` +
            "What needs fixing: {{trigger.fields.1.formatted}} · Urgency: {{trigger.fields.2.formatted}}",
          priority: "medium" as const,
          ...(args.spaceId ? { space_id: args.spaceId } : {}),
        },
      },
    },
  };
}
