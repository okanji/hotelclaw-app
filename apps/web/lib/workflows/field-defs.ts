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
    }
  | {
      // Pick one other step by id (e.g. a foreach loop body's first step).
      kind: "step-ref";
      key: string;
      label: string;
      help?: string;
      required?: boolean;
    }
  | {
      // Pick several other steps by id (e.g. parallel branch starts).
      kind: "step-ref-list";
      key: string;
      label: string;
      help?: string;
      minItems?: number;
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
  label: "Instructions for the AI (optional)",
  placeholder: "e.g. ‘Be concise and friendly’ or ‘Use simple language for guests’",
  help: "Tell the AI how to sound and what to focus on in this step. Leave blank for a neutral, professional tone.",
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
      label: "What to classify",
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
      key: "instructions",
      label: "What the AI should do",
      placeholder: "Investigate the issue and propose a concrete fix…",
      required: true,
      rows: 3,
    },
    {
      kind: "textarea",
      key: "input",
      label: "Data to work on (optional)",
      placeholder: "{{trigger.new.description}}",
      help: TEMPLATE_HELP,
      rows: 2,
    },
    {
      kind: "textarea",
      key: "persona",
      label: "Acts as (optional)",
      placeholder: "You are a friendly front-desk concierge…",
      help: "Leave blank for a neutral hotel-operations assistant.",
      rows: 2,
    },
    {
      kind: "number",
      key: "max_steps",
      label: "Lookup budget",
      default: 5,
      min: 1,
      max: 20,
      help: "If knowledge tools are connected, how many lookups the AI may make before answering. Without tools the AI answers in one go and this has no effect.",
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
    {
      kind: "template",
      key: "space_id",
      label: "Team (optional)",
      placeholder: "Space id, or {{trigger.new.space_id}}",
      help: TEMPLATE_HELP,
    },
    {
      kind: "template",
      key: "project_id",
      label: "Project (optional)",
      placeholder: "Project id, or {{trigger.new.project_id}}",
      help: TEMPLATE_HELP,
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

  // ─── Forms ─────────────────────────────────────────────────────────────
  "action.form.send": [
    {
      kind: "channel",
      key: "channel_id",
      label: "Channel",
      required: true,
    },
    {
      kind: "template",
      key: "form_id",
      label: "Form",
      placeholder: "Form ID — copy it from the form's page URL",
      help: "Paste the form's ID (the UUID in the form's page URL). The form must be published.",
      required: true,
    },
    {
      kind: "textarea",
      key: "message",
      label: "Message (optional)",
      placeholder: "Please fill out this form",
      help: TEMPLATE_HELP,
      rows: 2,
    },
  ],

  // ─── Bookings ──────────────────────────────────────────────────────────
  "action.booking.create": [
    {
      kind: "template",
      key: "service_id",
      label: "Service",
      placeholder: "Service ID — copy it from Bookings → Services",
      help: "The bookable service's ID. Hours and capacity are enforced — the step fails if the slot is full.",
      required: true,
    },
    {
      kind: "template",
      key: "starts_at",
      label: "Start time",
      placeholder: '{{trigger.starts_at}} or "2026-07-01T19:00"',
      help: "ISO timestamp, or a wall time in the service's timezone when no offset is given.",
      required: true,
    },
    {
      kind: "template",
      key: "guest_name",
      label: "Guest name",
      placeholder: "{{trigger.guest_name}}",
      required: true,
    },
    {
      kind: "template",
      key: "party_size",
      label: "Party size",
      placeholder: "{{trigger.party_size}} or 2",
    },
    {
      kind: "template",
      key: "guest_phone",
      label: "Guest phone (optional)",
      placeholder: "{{trigger.guest_phone}}",
    },
    {
      kind: "textarea",
      key: "notes",
      label: "Notes (optional)",
      placeholder: "Booked automatically — {{trigger.form_title}}",
      help: TEMPLATE_HELP,
      rows: 2,
    },
  ],
  "action.booking.set_status": [
    {
      kind: "template",
      key: "booking_id",
      label: "Booking",
      placeholder: "{{trigger.booking_id}}",
      help: "Usually the booking that triggered this workflow.",
      required: true,
    },
    {
      kind: "enum",
      key: "status",
      label: "Set status to",
      options: [
        { value: "confirmed", label: "Confirmed" },
        { value: "cancelled", label: "Cancelled" },
        { value: "completed", label: "Completed" },
        { value: "no_show", label: "No-show" },
      ],
      default: "confirmed",
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
      placeholder: "30",
      help: "Enter a number and choose a unit — e.g. 30 minutes, 2 hours, 1 day.",
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
    {
      kind: "template",
      key: "space_id",
      label: "Move to team",
      placeholder: "Space id, or {{trigger.new.space_id}}",
      help: TEMPLATE_HELP,
    },
    {
      kind: "template",
      key: "project_id",
      label: "Move to project",
      placeholder: "Project id, or {{trigger.new.project_id}}",
      help: TEMPLATE_HELP,
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
      placeholder: "Write the document content here…",
      help: TEMPLATE_HELP,
      rows: 4,
    },
    {
      kind: "text",
      key: "parent_id",
      label: "Parent doc (optional)",
      placeholder: "Leave blank for a top-level doc",
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
      placeholder: "The board to pin it to",
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
      placeholder: "Leave blank to leave them unassigned",
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
      label: "Only matching (optional)",
      keyPlaceholder: "e.g. room_number",
      valuePlaceholder: "e.g. 203",
      help: "Leave blank to find all. Add field/value pairs to narrow the results.",
    },
    {
      kind: "number",
      key: "limit",
      label: "Return up to",
      default: 10,
      min: 1,
      max: 100,
      help: "How many matches to bring back (1–100).",
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
      label: "Name for each item",
      placeholder: "item",
      help: "Each item in the list is given this name so later steps can refer to it (e.g. “room” or “item”).",
    },
    {
      kind: "step-ref",
      key: "body_start",
      label: "First step to run for each item",
      required: true,
      help: "Pick the step that starts the loop body.",
    },
  ],
  "control.parallel": [
    {
      kind: "step-ref-list",
      key: "branches",
      label: "First step of each parallel branch",
      minItems: 2,
      help: "Each branch runs from its first step until the step after this one.",
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
      placeholder:
        "Investigate this booking's history and create a summary task for the front desk.",
      help: TEMPLATE_HELP,
      required: true,
      rows: 3,
    },
  ],

  // ─── Outbound integrations ─────────────────────────────────────────────────
  "action.http.request": [
    {
      kind: "enum",
      key: "method",
      label: "Method",
      default: "POST",
      options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
        { value: "PUT", label: "PUT" },
        { value: "PATCH", label: "PATCH" },
        { value: "DELETE", label: "DELETE" },
      ],
    },
    {
      kind: "template",
      key: "url",
      label: "URL",
      placeholder: "https://api.example.com/hook",
      required: true,
      help: TEMPLATE_HELP,
    },
    {
      kind: "key-value",
      key: "headers",
      label: "Headers (optional)",
      keyPlaceholder: "Authorization",
      valuePlaceholder: "Bearer …",
    },
    {
      kind: "textarea",
      key: "body",
      label: "Body (optional)",
      placeholder: '{"task": "{{trigger.new.title}}"}',
      help: "JSON or text. Use Insert data to include values. Sent for POST/PUT/PATCH.",
      rows: 4,
    },
  ],
  "action.email.send": [
    {
      kind: "template",
      key: "to",
      label: "To",
      placeholder: "guest@example.com",
      required: true,
      help: TEMPLATE_HELP,
    },
    {
      kind: "template",
      key: "subject",
      label: "Subject",
      placeholder: "Your booking is confirmed",
      required: true,
      help: TEMPLATE_HELP,
    },
    {
      kind: "textarea",
      key: "body",
      label: "Message",
      placeholder: "Hi {{trigger.new.title}}, …",
      required: true,
      help: TEMPLATE_HELP,
      rows: 5,
    },
    {
      kind: "text",
      key: "from",
      label: "From (optional)",
      placeholder: "Front Desk <desk@yourhotel.com>",
      help: "Defaults to the configured Resend sender if blank.",
    },
  ],
  "action.telegram.send": [
    {
      kind: "template",
      key: "chat_id",
      label: "Chat ID",
      placeholder: "-1001234567890",
      required: true,
      help: "The Telegram chat or group id your bot can post to.",
    },
    {
      kind: "textarea",
      key: "text",
      label: "Message",
      required: true,
      help: TEMPLATE_HELP,
      rows: 4,
    },
  ],
  "action.whatsapp.send": [
    {
      kind: "template",
      key: "to",
      label: "To (phone number)",
      placeholder: "+15551234567",
      required: true,
      help: "Recipient phone number in international format.",
    },
    {
      kind: "textarea",
      key: "text",
      label: "Message",
      required: true,
      help: TEMPLATE_HELP,
      rows: 4,
    },
  ],
};
