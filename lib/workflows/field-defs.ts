// Per-step-type form definitions. The inspector reads these to render a
// friendly typed form instead of raw JSON. Keep this in sync with the Zod
// schemas in `spec.ts`; an unknown step type falls back to the JSON editor.
//
// Field kinds
//   • template   — a string that can also pull in live data; the field shows an
//                  "insert data" control and renders chosen data as a friendly
//                  chip, so users never see or type a {{dotted.path}}.
//   • text       — a plain string, no data insertion
//   • textarea   — multiline text (also supports inserted data)
//   • enum       — radio cards / chips with labelled options
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
    }
  | {
      kind: "channel";
      key: string;
      label: string;
      help?: string;
      required?: boolean;
    };

// Shown under data-capable fields. No template syntax — the "Insert data"
// control does the work, so we just point people at it.
const TEMPLATE_HELP =
  "Type text, or use Insert data to pull from the trigger or a previous step.";
const TASK_TEXT_INPUT_HELP =
  "Usually the task description from the trigger — that’s where complaint details live.";

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
      label: "What to summarize",
      placeholder: "e.g. task description from the trigger",
      help: TASK_TEXT_INPUT_HELP,
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
      placeholder: "The text you want sorted into a label",
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
      placeholder: "The message you want to reply to",
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
      placeholder: "The text the AI should look at",
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
      placeholder: "The user's message or request",
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
      help: "More than 5 switches this workflow to the durable runtime.",
    },
  ],

  // ─── Task actions ──────────────────────────────────────────────────────
  "action.task.create": [
    {
      kind: "template",
      key: "title",
      label: "Title",
      placeholder: "Follow up with the guest",
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
      label: "Task",
      placeholder: "The task to add the label to",
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
      kind: "channel",
      key: "channel_id",
      label: "Channel",
      required: true,
    },
    {
      kind: "textarea",
      key: "text",
      label: "Message",
      placeholder: "🚨 New high-priority task",
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
      label: "Who to notify",
      placeholder: "The person to notify",
      required: true,
    },
    {
      kind: "template",
      key: "title",
      label: "Notification title",
      placeholder: "Guest complaint escalated",
      required: true,
    },
    {
      kind: "textarea",
      key: "body",
      label: "Message body",
      placeholder: "Use Insert data to include a summary from an earlier step",
      help: TEMPLATE_HELP,
      rows: 3,
    },
  ],
  "action.notify.role": [
    {
      kind: "enum",
      key: "role",
      label: "Who receives this",
      options: [
        { value: "owner", label: "Owners" },
        { value: "manager", label: "Managers" },
        { value: "staff", label: "Staff" },
      ],
    },
    {
      kind: "template",
      key: "title",
      label: "Notification title",
      placeholder: "Guest complaint escalated",
      required: true,
    },
    {
      kind: "textarea",
      key: "body",
      label: "Message body",
      placeholder: "e.g. summary from the AI step above",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
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
      label: "Value to branch on",
      placeholder: "The value to route on",
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
    {
      kind: "template",
      key: "task_id",
      label: "Task",
      placeholder: "The task to update",
      required: true,
    },
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
    {
      kind: "template",
      key: "assignee_id",
      label: "Assign to",
      placeholder: "Who to assign it to",
    },
  ],
  "action.task.assign": [
    {
      kind: "template",
      key: "task_id",
      label: "Task",
      placeholder: "The task to assign",
      required: true,
    },
    {
      kind: "template",
      key: "assignee_id",
      label: "Assign to",
      placeholder: "Who to assign it to",
      required: true,
    },
  ],
  "action.chat.post_thread_reply": [
    {
      kind: "channel",
      key: "channel_id",
      label: "Channel",
      required: true,
    },
    {
      kind: "template",
      key: "parent_id",
      label: "Reply under",
      placeholder: "The message to reply under",
      required: true,
    },
    {
      kind: "textarea",
      key: "text",
      label: "Reply",
      placeholder: "On it — sending someone up now.",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
    },
  ],
  "action.chat.mention_user": [
    {
      kind: "channel",
      key: "channel_id",
      label: "Channel",
      required: true,
    },
    {
      kind: "template",
      key: "user_id",
      label: "Who to mention",
      placeholder: "The person to mention",
      required: true,
    },
    {
      kind: "textarea",
      key: "text",
      label: "Message",
      placeholder: "can you take this one?",
      help: TEMPLATE_HELP,
      required: true,
      rows: 2,
    },
  ],
  "action.doc.create": [
    {
      kind: "template",
      key: "title",
      label: "Title",
      placeholder: "Shift handover — front desk",
      required: true,
    },
    {
      kind: "textarea",
      key: "body_markdown",
      label: "Body",
      placeholder: "Markdown content…",
      help: TEMPLATE_HELP,
      rows: 4,
    },
    {
      kind: "text",
      key: "parent_id",
      label: "Parent doc (optional)",
      placeholder: "a document id",
    },
  ],
  "action.doc.archive": [
    {
      kind: "template",
      key: "document_id",
      label: "Document",
      placeholder: "The document to archive",
      required: true,
    },
  ],
  "action.doc.add_to_board": [
    {
      kind: "template",
      key: "document_id",
      label: "Document",
      placeholder: "The document to pin",
      required: true,
    },
    {
      kind: "template",
      key: "board_id",
      label: "Board",
      placeholder: "The board id",
      required: true,
    },
  ],
  "action.doc.post_summary_in_chat": [
    {
      kind: "template",
      key: "document_id",
      label: "Document",
      placeholder: "The document to summarize",
      required: true,
    },
    {
      kind: "channel",
      key: "channel_id",
      label: "Channel",
      required: true,
    },
  ],
  "action.meeting.create_followup_tasks": [
    {
      kind: "template",
      key: "meeting_id",
      label: "Meeting",
      placeholder: "The meeting with action items",
      required: true,
    },
    {
      kind: "template",
      key: "assignee_id",
      label: "Assign all to (optional)",
      placeholder: "User id — leave blank to leave unassigned",
    },
  ],
  "action.meeting.share_summary_to_channel": [
    {
      kind: "template",
      key: "meeting_id",
      label: "Meeting",
      placeholder: "The meeting to share",
      required: true,
    },
    {
      kind: "channel",
      key: "channel_id",
      label: "Channel",
      required: true,
    },
  ],
  "action.entity.find": [
    {
      kind: "template",
      key: "entity_type",
      label: "Entity type",
      placeholder: "room",
      required: true,
    },
    {
      kind: "key-value",
      key: "where",
      label: "Filter by field",
      keyPlaceholder: "field",
      valuePlaceholder: "value",
    },
    {
      kind: "number",
      key: "limit",
      label: "Max results",
      default: 10,
      min: 1,
      max: 100,
    },
  ],
  "action.entity.delete": [
    {
      kind: "template",
      key: "entity_id",
      label: "Entity",
      placeholder: "The entity to delete",
      required: true,
    },
  ],
  "control.wait_for_event": [
    {
      kind: "enum",
      key: "event_type",
      label: "Event to wait for",
      options: [
        { value: "task.created", label: "Task created" },
        { value: "task.status_changed", label: "Task status changed" },
        { value: "task.assigned", label: "Task assigned" },
        { value: "task.label_added", label: "Label added to task" },
        { value: "chat.message_posted", label: "Chat message posted" },
        { value: "chat.mention", label: "User mentioned in chat" },
        { value: "doc.created", label: "Document created" },
        { value: "meeting.summary_ready", label: "Meeting summary ready" },
        { value: "manual.run", label: "Manual run" },
      ],
    },
    {
      kind: "duration",
      key: "timeout",
      label: "Timeout (optional)",
      placeholder: "24h",
      help: "Give up if the event doesn't arrive in time.",
    },
  ],
  "control.foreach": [
    {
      kind: "template",
      key: "items",
      label: "List to loop over",
      placeholder: "e.g. action items from the trigger",
      required: true,
      help: TEMPLATE_HELP,
    },
    {
      kind: "text",
      key: "item_var",
      label: "Variable name for each item",
      placeholder: "item",
    },
    {
      kind: "text",
      key: "body_start",
      label: "First step in the loop body",
      placeholder: "step id",
      required: true,
    },
  ],
  "control.parallel": [
    {
      kind: "string-list",
      key: "branches",
      label: "Branch start step ids",
      itemPlaceholder: "step id",
      minItems: 2,
      help: "Each branch runs from its start step until the step after this node.",
    },
    {
      kind: "enum",
      key: "join",
      label: "Wait for",
      default: "all",
      options: [
        { value: "all", label: "All branches" },
        { value: "any", label: "First branch to finish" },
      ],
    },
  ],
  "action.entity.create": [
    {
      kind: "template",
      key: "entity_type",
      label: "Entity type",
      placeholder: "room",
      required: true,
    },
    {
      kind: "key-value",
      key: "data",
      label: "Fields",
      keyPlaceholder: "field",
      valuePlaceholder: "value",
    },
  ],
  "action.entity.update": [
    {
      kind: "template",
      key: "entity_id",
      label: "Entity",
      placeholder: "The entity to update",
      required: true,
    },
    {
      kind: "key-value",
      key: "patch",
      label: "Fields to change",
      keyPlaceholder: "field",
      valuePlaceholder: "value",
    },
  ],
  "action.gbrain.capture": [
    {
      kind: "textarea",
      key: "text",
      label: "What to remember",
      placeholder: "VIP guest prefers a quiet room away from the elevator.",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
    },
    { kind: "string-list", key: "tags", label: "Tags", itemPlaceholder: "e.g. vip" },
  ],
  "action.external.delegate_to_openclaw": [
    {
      kind: "textarea",
      key: "goal",
      label: "Goal for the agent",
      placeholder: "Monitor this thread and escalate if unresolved in 30 min.",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
    },
  ],
};
