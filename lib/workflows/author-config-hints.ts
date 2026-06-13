import "server-only";
import { STEP_FIELDS } from "@/lib/workflows/field-defs";
import type { StepType, TriggerEventType } from "@/lib/workflows/spec";

/** Human-readable config requirements for the workflow author bot. */
export type AuthorConfigField = {
  key: string;
  required: boolean;
  description: string;
};

const CONTROL_FILTER_HINTS: AuthorConfigField[] = [
  {
    key: "expr",
    required: true,
    description:
      'JSONLogic predicate. Example label filter: { "in": ["guest-complaint", { "var": "trigger.added_labels" }] }. Example field compare: { "==": [{ "var": "trigger.new.priority" }, "high"] }.',
  },
];

const CONTROL_BRANCH_HINTS: AuthorConfigField[] = [
  {
    key: "expr",
    required: true,
    description: "JSONLogic predicate (same shape as control.filter).",
  },
];

/** Example configs the author bot can copy — grounded in real catalog shapes. */
const EXAMPLE_CONFIGS: Partial<Record<StepType, Record<string, unknown>>> = {
  "control.filter": {
    expr: { in: ["guest-complaint", { var: "trigger.added_labels" }] },
  },
  "control.branch_if": {
    expr: { "==": [{ var: "trigger.new.priority" }, "urgent"] },
  },
  "ai.summarize_text": {
    input: "{{trigger.new.description}}",
    length: "short",
  },
  "ai.freeform": {
    instructions: "Investigate the complaint and propose a concrete fix",
    input: "{{trigger.new.description}}",
  },
  "ai.classify_into": {
    input: "{{trigger.new.description}}",
    labels: ["urgent", "routine"],
  },
  "action.task.assign": {
    task_id: "{{trigger.new.id}}",
    assignee_id: "<property-member-user-id>",
  },
  "action.task.create": {
    title: "Follow up with guest",
    description: "{{trigger.new.description}}",
  },
  "action.notify.role": {
    role: "manager",
    title: "Guest complaint",
    body: "{{steps.summarize.output.summary}}",
    notification_type: "workflow",
  },
};

export function authorConfigFields(stepType: StepType): AuthorConfigField[] {
  if (stepType === "control.filter") return CONTROL_FILTER_HINTS;
  if (stepType === "control.branch_if") return CONTROL_BRANCH_HINTS;

  const fields = STEP_FIELDS[stepType];
  if (!fields?.length) {
    return [{ key: "config", required: true, description: "See describe_action examples." }];
  }

  return fields.map((f) => ({
    key: f.key,
    required: "required" in f && f.required === true,
    description:
      ("help" in f && f.help) ||
      ("placeholder" in f && f.placeholder) ||
      f.label,
  }));
}

export function authorExampleConfig(stepType: StepType): Record<string, unknown> | null {
  return EXAMPLE_CONFIGS[stepType] ?? null;
}

/** Trigger-level filter guidance — often better than a control.filter step. */
export function authorTriggerFilterHint(eventType: TriggerEventType): string | null {
  if (eventType === "task.label_added") {
    return (
      'Prefer trigger.filter.expr for label gating: { "in": ["your-label", { "var": "trigger.added_labels" }] }. ' +
      "Only add a control.filter step if you need extra conditions after other steps."
    );
  }
  if (eventType.startsWith("task.")) {
    return "Task triggers expose trigger.new (title, description, priority, assignee_id, labels, …). Use {{trigger.new.*}} in step configs.";
  }
  if (eventType === "schedule.cron" || eventType === "schedule.at_time") {
    return (
      "Set trigger.schedule.cron (and timezone) for recurring runs. Do NOT add empty trigger.filter. " +
      "For digests/reports, use ai.freeform to gather data, then action.chat.post_message — reference outputs as {{steps.<step_id>.output.text}} using the actual step id from your spec. " +
      "Avoid redundant ai.summarize_text after ai.freeform unless the freeform step returns raw data to summarize."
    );
  }
  return null;
}
