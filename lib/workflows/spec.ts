import { z } from "zod";

// Single Zod source of truth for the WorkflowSpec. The AI authoring bot emits it,
// the canvas renders it, the executor runs it. Keep these schemas tight — they
// are the public surface between three independent layers.
//
// Variable refs live as template strings ("{{trigger.task.title}}") inside any
// string-typed config field. We validate that each {{...}} resolves at save time
// (see lib/workflows/validate.ts), not at parse time — Zod just sees strings.

// ─── Trigger ─────────────────────────────────────────────────────────────────

export const TRIGGER_EVENT_TYPES = [
  "task.created",
  "task.status_changed",
  "task.assigned",
  "task.overdue",
  "task.label_added",
  "task.added_to_space",
  "task.added_to_project",
  "chat.message_posted",
  "chat.mention",
  "doc.created",
  "doc.archived",
  "meeting.ended",
  "meeting.summary_ready",
  "calendar.event.created",
  "calendar.conflict_detected",
  "entity.created",
  "entity.field_changed",
  "schedule.cron",
  "schedule.at_time",
  "manual.run",
  "webhook.received",
  "form.submitted",
] as const;

export type TriggerEventType = (typeof TRIGGER_EVENT_TYPES)[number];

// Predicates over the trigger payload are JSONLogic-style trees. Kept loose at the
// schema layer (z.unknown()) because the predicate shape is recursive and the
// runtime evaluator already validates each operator.
const TriggerFilter = z
  .object({
    expr: z.unknown(),
  })
  .partial()
  .passthrough();

const TriggerNode = z.object({
  event_type: z.enum(TRIGGER_EVENT_TYPES),
  // Optional filter — e.g. { expr: { "==": [{ var: "new.priority" }, "urgent"] } }
  filter: TriggerFilter.optional(),
  // For entity.* triggers: which entity type by name (e.g. "room", "guest").
  entity_type: z.string().optional(),
  // For schedule.cron: the cron expression. For schedule.at_time: the ISO datetime.
  schedule: z
    .object({
      cron: z.string().optional(),
      timezone: z.string().optional(),
      at: z.string().datetime().optional(),
    })
    .optional(),
});

// ─── Common step fields ─────────────────────────────────────────────────────

const RetryConfig = z
  .object({
    max: z.number().int().min(0).max(10).default(0),
    backoff: z.enum(["exp", "linear"]).default("exp"),
    initial_ms: z.number().int().min(100).max(60_000).default(1000),
  })
  .default({ max: 0, backoff: "exp", initial_ms: 1000 });

const OnError = z
  .union([z.literal("fail"), z.literal("continue"), z.string().regex(/^branch:.+/)])
  .default("fail");

const StepCommon = {
  id: z.string().min(1),
  label: z.string().optional(), // canvas-friendly name
  next: z.string().optional(),
  retry: RetryConfig.optional(),
  on_error: OnError.optional(),
};

// Template-string config values. Zod can't validate that {{...}} resolves; the
// validate.ts reference-pass does that. We just enforce non-empty strings here.
const TplString = z.string().min(1);

// ─── Catalog action steps ───────────────────────────────────────────────────

const CreateTaskStep = z.object({
  ...StepCommon,
  type: z.literal("action.task.create"),
  config: z.object({
    title: TplString,
    description: z.string().optional(),
    assignee_id: z.string().optional(),
    due_at: z.string().optional(),
    labels: z.array(z.string()).optional(),
    project_name: z.string().optional(),
    space_id: z.string().optional(),
    project_id: z.string().optional(),
    priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
    parent_id: z.string().optional(),
  }),
});

const UpdateTaskStep = z.object({
  ...StepCommon,
  type: z.literal("action.task.update"),
  config: z.object({
    task_id: TplString,
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
    priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
    assignee_id: z.string().optional(),
    due_at: z.string().optional(),
    labels: z.array(z.string()).optional(),
    space_id: z.string().optional(),
    project_id: z.string().optional(),
  }),
});

const AssignTaskStep = z.object({
  ...StepCommon,
  type: z.literal("action.task.assign"),
  config: z.object({ task_id: TplString, assignee_id: TplString }),
});

const AddLabelStep = z.object({
  ...StepCommon,
  type: z.literal("action.task.add_label"),
  config: z.object({ task_id: TplString, label: TplString }),
});

const PostChatMessageStep = z.object({
  ...StepCommon,
  type: z.literal("action.chat.post_message"),
  config: z.object({
    channel_id: TplString,
    text: TplString,
  }),
});

const PostThreadReplyStep = z.object({
  ...StepCommon,
  type: z.literal("action.chat.post_thread_reply"),
  config: z.object({
    channel_id: TplString,
    parent_id: TplString,
    text: TplString,
  }),
});

const MentionUserStep = z.object({
  ...StepCommon,
  type: z.literal("action.chat.mention_user"),
  config: z.object({
    channel_id: TplString,
    user_id: TplString,
    text: TplString,
  }),
});

const CreateDocStep = z.object({
  ...StepCommon,
  type: z.literal("action.doc.create"),
  config: z.object({
    title: TplString,
    body_markdown: z.string().optional(),
    parent_id: z.string().optional(),
  }),
});

const ArchiveDocStep = z.object({
  ...StepCommon,
  type: z.literal("action.doc.archive"),
  config: z.object({ document_id: TplString }),
});

const AddToBoardStep = z.object({
  ...StepCommon,
  type: z.literal("action.doc.add_to_board"),
  config: z.object({ document_id: TplString, board_id: TplString }),
});

const PostSummaryInChatStep = z.object({
  ...StepCommon,
  type: z.literal("action.doc.post_summary_in_chat"),
  config: z.object({ document_id: TplString, channel_id: TplString }),
});

const CreateFollowupTasksStep = z.object({
  ...StepCommon,
  type: z.literal("action.meeting.create_followup_tasks"),
  config: z.object({ meeting_id: TplString, assignee_id: z.string().optional() }),
});

const ShareSummaryToChannelStep = z.object({
  ...StepCommon,
  type: z.literal("action.meeting.share_summary_to_channel"),
  config: z.object({ meeting_id: TplString, channel_id: TplString }),
});

const NotifyUserStep = z.object({
  ...StepCommon,
  type: z.literal("action.notify.user"),
  config: z.object({
    user_id: TplString,
    title: TplString,
    body: z.string().optional(),
    notification_type: z.string().default("workflow"),
  }),
});

const NotifyRoleStep = z.object({
  ...StepCommon,
  type: z.literal("action.notify.role"),
  config: z.object({
    role: z.enum(["owner", "manager", "staff"]),
    title: TplString,
    body: z.string().optional(),
    notification_type: z.string().default("workflow"),
  }),
});

const CreateEntityStep = z.object({
  ...StepCommon,
  type: z.literal("action.entity.create"),
  config: z.object({
    entity_type: TplString, // name, e.g. "room"
    data: z.record(z.string(), z.unknown()),
  }),
});

const UpdateEntityStep = z.object({
  ...StepCommon,
  type: z.literal("action.entity.update"),
  config: z.object({
    entity_id: TplString,
    patch: z.record(z.string(), z.unknown()),
  }),
});

const FindEntityStep = z.object({
  ...StepCommon,
  type: z.literal("action.entity.find"),
  config: z.object({
    entity_type: TplString,
    where: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().min(1).max(100).default(10),
  }),
});

const DeleteEntityStep = z.object({
  ...StepCommon,
  type: z.literal("action.entity.delete"),
  config: z.object({ entity_id: TplString }),
});

const DelegateToOpenclawStep = z.object({
  ...StepCommon,
  type: z.literal("action.external.delegate_to_openclaw"),
  config: z.object({
    goal: TplString,
    context: z.record(z.string(), z.unknown()).optional(),
  }),
});

const CaptureToGbrainStep = z.object({
  ...StepCommon,
  type: z.literal("action.gbrain.capture"),
  config: z.object({
    text: TplString,
    tags: z.array(z.string()).optional(),
  }),
});

// ─── Outbound integrations ──────────────────────────────────────────────────

const HttpRequestStep = z.object({
  ...StepCommon,
  type: z.literal("action.http.request"),
  config: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
    url: TplString,
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(), // template string — JSON or plain text
  }),
});

const EmailSendStep = z.object({
  ...StepCommon,
  type: z.literal("action.email.send"),
  config: z.object({
    to: TplString,
    subject: TplString,
    body: TplString, // plain text / simple HTML
    from: z.string().optional(),
  }),
});

const TelegramSendStep = z.object({
  ...StepCommon,
  type: z.literal("action.telegram.send"),
  config: z.object({
    chat_id: TplString,
    text: TplString,
  }),
});

const WhatsappSendStep = z.object({
  ...StepCommon,
  type: z.literal("action.whatsapp.send"),
  config: z.object({
    to: TplString, // E.164 phone number
    text: TplString,
  }),
});

// ─── AI steps ───────────────────────────────────────────────────────────────

const AiSummarizeStep = z.object({
  ...StepCommon,
  type: z.literal("ai.summarize_text"),
  config: z.object({
    input: TplString,
    length: z.enum(["short", "medium", "long"]).default("medium"),
    persona_hint: z.string().optional(),
  }),
});

const AiClassifyStep = z.object({
  ...StepCommon,
  type: z.literal("ai.classify_into"),
  config: z.object({
    input: TplString,
    labels: z.array(z.string().min(1)).min(2),
    persona_hint: z.string().optional(),
  }),
});

const AiExtractStep = z.object({
  ...StepCommon,
  type: z.literal("ai.extract_fields"),
  config: z.object({
    input: TplString,
    fields: z.record(
      z.string(),
      z.object({
        type: z.enum(["string", "number", "boolean", "string[]"]),
        description: z.string().optional(),
        required: z.boolean().default(false),
      }),
    ),
    persona_hint: z.string().optional(),
  }),
});

const AiDraftReplyStep = z.object({
  ...StepCommon,
  type: z.literal("ai.draft_reply"),
  config: z.object({
    input: TplString,
    tone: z.enum(["formal", "warm", "concise", "apologetic", "celebratory"]).default("warm"),
    persona_hint: z.string().optional(),
  }),
});

const AiBranchDecisionStep = z.object({
  ...StepCommon,
  type: z.literal("ai.branch_decision"),
  config: z.object({
    input: TplString,
    question: TplString,
    persona_hint: z.string().optional(),
  }),
  branches: z.object({
    true: z.string(),
    false: z.string(),
  }),
});

const AiFreeformStep = z.object({
  ...StepCommon,
  type: z.literal("ai.freeform"),
  config: z.object({
    persona: TplString,
    input: TplString,
    tools: z.array(z.string()).optional(),
    max_steps: z.number().int().min(1).max(20).default(5),
  }),
});

// ─── Control flow ───────────────────────────────────────────────────────────

const FilterStep = z.object({
  ...StepCommon,
  type: z.literal("control.filter"),
  config: z.object({
    expr: z.unknown(), // JSONLogic predicate over upstream vars
  }),
});

const BranchIfStep = z.object({
  ...StepCommon,
  type: z.literal("control.branch_if"),
  config: z.object({
    expr: z.unknown(),
  }),
  branches: z.object({
    true: z.string(),
    false: z.string(),
  }),
});

const BranchSwitchStep = z.object({
  ...StepCommon,
  type: z.literal("control.branch_switch"),
  config: z.object({
    input: TplString,
  }),
  branches: z.record(z.string(), z.string()), // value -> next step id, plus optional "_default"
});

const DelayStep = z.object({
  ...StepCommon,
  type: z.literal("control.delay"),
  config: z.object({
    duration: z.string().regex(/^\d+\s*(s|m|h|d)$/), // "30m", "2h", "1d"
  }),
});

const WaitForEventStep = z.object({
  ...StepCommon,
  type: z.literal("control.wait_for_event"),
  config: z.object({
    event_type: z.enum(TRIGGER_EVENT_TYPES),
    correlate: z.record(z.string(), TplString).optional(), // { "new.id": "{{trigger.new.id}}" }
    timeout: z.string().regex(/^\d+\s*(s|m|h|d)$/).optional(),
  }),
});

const ForeachStep = z.object({
  ...StepCommon,
  type: z.literal("control.foreach"),
  config: z.object({
    items: TplString, // ref to an array variable
    item_var: z.string().default("item"),
    body_start: z.string(), // step id where the iteration body begins
  }),
});

const ParallelStep = z.object({
  ...StepCommon,
  type: z.literal("control.parallel"),
  config: z.object({
    branches: z.array(z.string()).min(2), // step ids of branch starts
    join: z.enum(["all", "any"]).default("all"),
  }),
});

const EndStep = z.object({
  ...StepCommon,
  type: z.literal("control.end"),
  config: z
    .object({
      outcome: z.string().optional(), // analytics label
    })
    .default({}),
});

// ─── Discriminated union of every step type ─────────────────────────────────

export const StepNode = z.discriminatedUnion("type", [
  CreateTaskStep,
  UpdateTaskStep,
  AssignTaskStep,
  AddLabelStep,
  PostChatMessageStep,
  PostThreadReplyStep,
  MentionUserStep,
  CreateDocStep,
  ArchiveDocStep,
  AddToBoardStep,
  PostSummaryInChatStep,
  CreateFollowupTasksStep,
  ShareSummaryToChannelStep,
  NotifyUserStep,
  NotifyRoleStep,
  CreateEntityStep,
  UpdateEntityStep,
  FindEntityStep,
  DeleteEntityStep,
  DelegateToOpenclawStep,
  CaptureToGbrainStep,
  HttpRequestStep,
  EmailSendStep,
  TelegramSendStep,
  WhatsappSendStep,
  AiSummarizeStep,
  AiClassifyStep,
  AiExtractStep,
  AiDraftReplyStep,
  AiBranchDecisionStep,
  AiFreeformStep,
  FilterStep,
  BranchIfStep,
  BranchSwitchStep,
  DelayStep,
  WaitForEventStep,
  ForeachStep,
  ParallelStep,
  EndStep,
]);

export type StepNode = z.infer<typeof StepNode>;
export type StepType = StepNode["type"];

// ─── Variable declarations + metadata ───────────────────────────────────────

const VariableDecl = z.object({
  type: z.enum(["string", "number", "boolean", "json"]),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

// ─── The spec itself ────────────────────────────────────────────────────────

// Optional canvas-layout map — when a user arranges nodes in the visual
// builder, positions land here keyed by step id (plus `__trigger__`). The
// runtime ignores this; if missing, the canvas auto-lays out with BFS.
const NodePosition = z.object({
  x: z.number(),
  y: z.number(),
});

export const WorkflowSpec = z.object({
  workflow_spec_version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: TriggerNode,
  entry_step_id: z.string().min(1),
  steps: z.record(z.string(), StepNode),
  variables: z.record(z.string(), VariableDecl).optional(),
  layout: z.record(z.string(), NodePosition).optional(),
  metadata: z
    .object({
      last_edited_by: z.enum(["ai", "human"]).optional(),
      ai_explanation: z.string().optional(),
    })
    .default({}),
});

export type WorkflowSpec = z.infer<typeof WorkflowSpec>;
export type TriggerNode = z.infer<typeof TriggerNode>;

// ─── Mode classifier ────────────────────────────────────────────────────────

/**
 * Server-side: decide whether a spec can run in the cheap in-process lane or
 * needs the durable runtime (Vercel Workflow SDK). Surfaced to the user as a
 * "Runs instantly" vs "Runs durably" badge.
 */
export function classifyMode(spec: WorkflowSpec): "instant" | "durable" {
  const stepEntries = Object.values(spec.steps);
  if (stepEntries.length > 10) return "durable";

  for (const step of stepEntries) {
    if (
      step.type === "control.delay" ||
      step.type === "control.wait_for_event" ||
      step.type === "control.foreach" ||
      step.type === "control.parallel"
    ) {
      return "durable";
    }
    if (step.type === "ai.freeform" && step.config.max_steps > 5) {
      return "durable";
    }
  }

  if (spec.trigger.event_type === "schedule.cron" || spec.trigger.event_type === "schedule.at_time") {
    return "durable";
  }

  return "instant";
}
