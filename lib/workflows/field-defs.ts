// Per-step-type form definitions. The inspector reads these to render a
// friendly typed form instead of raw JSON. Keep this in sync with the Zod
// schemas in `spec.ts`; an unknown step type falls back to the JSON editor.
//
// Field kinds
//   • template   — a string that can contain {{variable.refs}}; we hint the
//                  syntax in the help text and render a single-line input.
//   • text       — a plain string with no variable hint
//   • textarea   — multiline text (also supports templates)
//   • enum       — radio-or-select with labelled options
//   • number     — bounded integer/float
//   • duration   — `\d+(s|m|h|d)` short-form, e.g. "30m", "2h"
//   • string-list— editable array of strings
//
// All values are merged onto the step's existing `config` object so existing
// extra keys are preserved when partial.

import type { StepType } from "./spec";

export type FieldDef =
  | {
      kind: "template" | "text";
      key: string;
      label: string;
      placeholder?: string;
      help?: string;
      required?: boolean;
    }
  | {
      kind: "textarea";
      key: string;
      label: string;
      placeholder?: string;
      help?: string;
      required?: boolean;
      rows?: number;
    }
  | {
      kind: "enum";
      key: string;
      label: string;
      help?: string;
      options: { value: string; label: string; description?: string }[];
      default?: string;
    }
  | {
      kind: "number";
      key: string;
      label: string;
      help?: string;
      min?: number;
      max?: number;
      default?: number;
    }
  | {
      kind: "duration";
      key: string;
      label: string;
      help?: string;
      placeholder?: string;
    }
  | {
      kind: "string-list";
      key: string;
      label: string;
      help?: string;
      itemPlaceholder?: string;
      minItems?: number;
    }
  | {
      kind: "key-value";
      key: string;
      label: string;
      help?: string;
      keyPlaceholder?: string;
      valuePlaceholder?: string;
    };

const TEMPLATE_HELP =
  "Use {{trigger.new.X}} for trigger fields or {{steps.<id>.output.Y}} for prior step outputs.";

const PERSONA_HINT: FieldDef = {
  kind: "textarea",
  key: "persona_hint",
  label: "Persona hint (optional)",
  placeholder: "How should the AI behave? e.g. ‘Be concise and friendly’",
  help: "Steers the AI's tone and focus for this specific step.",
  rows: 2,
};

export const STEP_FIELDS: Partial<Record<StepType, FieldDef[]>> = {
  // ─── AI ────────────────────────────────────────────────────────────────
  "ai.summarize_text": [
    {
      kind: "textarea",
      key: "input",
      label: "Text to summarize",
      placeholder: "{{trigger.new.description}}",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
    },
    {
      kind: "enum",
      key: "length",
      label: "Length",
      default: "medium",
      options: [
        { value: "short", label: "Short", description: "~25 words" },
        { value: "medium", label: "Medium", description: "~75 words" },
        { value: "long", label: "Long", description: "~200 words" },
      ],
    },
    PERSONA_HINT,
  ],
  "ai.classify_into": [
    {
      kind: "textarea",
      key: "input",
      label: "Text to classify",
      placeholder: "{{trigger.new.title}}",
      help: TEMPLATE_HELP,
      required: true,
      rows: 2,
    },
    {
      kind: "string-list",
      key: "labels",
      label: "Possible labels",
      itemPlaceholder: "e.g. urgent",
      help: "At least 2 labels. The AI picks exactly one.",
      minItems: 2,
    },
    PERSONA_HINT,
  ],
  "ai.draft_reply": [
    {
      kind: "textarea",
      key: "input",
      label: "What to reply to",
      placeholder: "{{trigger.message.text}}",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
    },
    {
      kind: "enum",
      key: "tone",
      label: "Tone",
      default: "warm",
      options: [
        { value: "formal", label: "Formal" },
        { value: "warm", label: "Warm" },
        { value: "concise", label: "Concise" },
        { value: "apologetic", label: "Apologetic" },
        { value: "celebratory", label: "Celebratory" },
      ],
    },
    PERSONA_HINT,
  ],
  "ai.branch_decision": [
    {
      kind: "textarea",
      key: "input",
      label: "What to evaluate",
      placeholder: "{{trigger.new.description}}",
      help: TEMPLATE_HELP,
      required: true,
      rows: 2,
    },
    {
      kind: "text",
      key: "question",
      label: "Yes/no question",
      placeholder: "Is this guest complaint about a refund?",
      required: true,
    },
    PERSONA_HINT,
  ],
  "ai.freeform": [
    {
      kind: "textarea",
      key: "persona",
      label: "Persona / system prompt",
      placeholder: "You are a friendly front-desk concierge…",
      required: true,
      rows: 3,
    },
    {
      kind: "textarea",
      key: "input",
      label: "User prompt",
      placeholder: "{{trigger.message.text}}",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
    },
    {
      kind: "number",
      key: "max_steps",
      label: "Max tool-calling steps",
      default: 5,
      min: 1,
      max: 20,
      help: ">5 forces the durable runtime.",
    },
  ],

  // ─── Task actions ──────────────────────────────────────────────────────
  "action.task.create": [
    {
      kind: "template",
      key: "title",
      label: "Title",
      placeholder: "Follow up with {{trigger.new.guest_name}}",
      required: true,
    },
    {
      kind: "textarea",
      key: "description",
      label: "Description",
      placeholder: "Optional details…",
      help: TEMPLATE_HELP,
      rows: 3,
    },
    {
      kind: "enum",
      key: "priority",
      label: "Priority",
      default: "none",
      options: [
        { value: "none", label: "None" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" },
      ],
    },
    {
      kind: "string-list",
      key: "labels",
      label: "Labels",
      itemPlaceholder: "e.g. guest-complaint",
    },
  ],
  "action.task.add_label": [
    {
      kind: "template",
      key: "task_id",
      label: "Task ID",
      placeholder: "{{trigger.new.id}}",
      required: true,
    },
    {
      kind: "template",
      key: "label",
      label: "Label",
      placeholder: "needs-review",
      required: true,
    },
  ],

  // ─── Chat actions ──────────────────────────────────────────────────────
  "action.chat.post_message": [
    {
      kind: "template",
      key: "channel_id",
      label: "Channel ID",
      placeholder: "general or {{trigger.channel.id}}",
      required: true,
    },
    {
      kind: "textarea",
      key: "text",
      label: "Message",
      placeholder: "🚨 New high-priority task: {{trigger.new.title}}",
      help: TEMPLATE_HELP,
      required: true,
      rows: 4,
    },
  ],

  // ─── Notify ────────────────────────────────────────────────────────────
  "action.notify.user": [
    {
      kind: "template",
      key: "user_id",
      label: "User to notify",
      placeholder: "{{trigger.new.assignee_id}}",
      required: true,
    },
    {
      kind: "template",
      key: "text",
      label: "Message",
      placeholder: "You were assigned a new task.",
      required: true,
    },
  ],
  "action.notify.role": [
    {
      kind: "enum",
      key: "role",
      label: "Role",
      options: [
        { value: "owner", label: "Owners" },
        { value: "manager", label: "Managers" },
        { value: "staff", label: "Staff" },
      ],
    },
    {
      kind: "template",
      key: "text",
      label: "Message",
      placeholder: "Heads up: {{trigger.new.title}} needs attention.",
      required: true,
    },
  ],

  // ─── Control flow ──────────────────────────────────────────────────────
  "control.delay": [
    {
      kind: "duration",
      key: "duration",
      label: "Wait for",
      placeholder: "30m",
      help: "Use s, m, h, or d — e.g. 90s, 30m, 2h, 1d.",
    },
  ],
  "control.branch_switch": [
    {
      kind: "template",
      key: "input",
      label: "Value to switch on",
      placeholder: "{{steps.classify.output.label}}",
      required: true,
      help: TEMPLATE_HELP,
    },
  ],
  "control.end": [
    {
      kind: "text",
      key: "outcome",
      label: "Outcome label (optional)",
      placeholder: "completed",
      help: "Shown in run history and analytics.",
    },
  ],

  // ─── Backfilled task / chat / doc / entity forms ───────────────────────────
  "action.task.update": [
    { kind: "template", key: "task_id", label: "Task", placeholder: "{{trigger.new.id}}", required: true },
    {
      kind: "enum",
      key: "status",
      label: "Set status",
      options: [
        { value: "todo", label: "To do" },
        { value: "in_progress", label: "In progress" },
        { value: "blocked", label: "Blocked" },
        { value: "done", label: "Done" },
      ],
    },
    {
      kind: "enum",
      key: "priority",
      label: "Set priority",
      options: [
        { value: "none", label: "None" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" },
      ],
    },
    { kind: "template", key: "assignee_id", label: "Assign to", placeholder: "{{trigger.new.assignee_id}}" },
  ],
  "action.task.assign": [
    { kind: "template", key: "task_id", label: "Task", placeholder: "{{trigger.new.id}}", required: true },
    { kind: "template", key: "assignee_id", label: "Assign to", placeholder: "a user id", required: true },
  ],
  "action.chat.post_thread_reply": [
    { kind: "template", key: "channel_id", label: "Channel", placeholder: "front-desk", required: true },
    { kind: "template", key: "parent_id", label: "Parent message", placeholder: "{{trigger.message.id}}", required: true },
    { kind: "textarea", key: "text", label: "Reply", placeholder: "On it — sending someone up now.", help: TEMPLATE_HELP, required: true, rows: 3 },
  ],
  "action.chat.mention_user": [
    { kind: "template", key: "channel_id", label: "Channel", placeholder: "front-desk", required: true },
    { kind: "template", key: "user_id", label: "User to mention", placeholder: "{{trigger.new.assignee_id}}", required: true },
    { kind: "textarea", key: "text", label: "Message", placeholder: "can you take this one?", help: TEMPLATE_HELP, required: true, rows: 2 },
  ],
  "action.doc.create": [
    { kind: "template", key: "title", label: "Title", placeholder: "Shift handover — {{trigger.new.title}}", required: true },
    { kind: "textarea", key: "body_markdown", label: "Body", placeholder: "Markdown content…", help: TEMPLATE_HELP, rows: 4 },
    { kind: "text", key: "parent_id", label: "Parent doc (optional)", placeholder: "a document id" },
  ],
  "action.doc.archive": [
    { kind: "template", key: "document_id", label: "Document", placeholder: "{{trigger.new.id}}", required: true },
  ],
  "action.entity.create": [
    { kind: "template", key: "entity_type", label: "Entity type", placeholder: "room", required: true },
    { kind: "key-value", key: "data", label: "Fields", keyPlaceholder: "field", valuePlaceholder: "value or {{ref}}" },
  ],
  "action.entity.update": [
    { kind: "template", key: "entity_id", label: "Entity", placeholder: "{{trigger.new.id}}", required: true },
    { kind: "key-value", key: "patch", label: "Fields to change", keyPlaceholder: "field", valuePlaceholder: "value or {{ref}}" },
  ],
  "action.gbrain.capture": [
    { kind: "textarea", key: "text", label: "What to remember", placeholder: "VIP guest prefers a quiet room away from the elevator.", help: TEMPLATE_HELP, required: true, rows: 3 },
    { kind: "string-list", key: "tags", label: "Tags", itemPlaceholder: "e.g. vip" },
  ],
  "action.external.delegate_to_openclaw": [
    { kind: "textarea", key: "goal", label: "Goal for the agent", placeholder: "Monitor this thread and escalate if unresolved in 30 min.", help: TEMPLATE_HELP, required: true, rows: 3 },
  ],
};
