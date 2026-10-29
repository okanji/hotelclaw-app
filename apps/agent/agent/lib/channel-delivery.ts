/**
 * Runtime-side Stream delivery for DEFAULT CHANNEL BOT sessions — the
 * executor half of the `events` handlers in agent/channels/eve.ts.
 *
 * Eve channel doctrine (docs/channels/custom + channels/eve): event
 * handlers "deliver completed messages back to the surface that owns this
 * channel" — delivery happens in workflow compute when the turn actually
 * finishes, so no HTTP function is ever held open and turn length is
 * unbounded ("The workflow holds no compute resources during these
 * waits" — execution-model docs).
 *
 * Durable accumulation lives on channel_bot_sessions (migration 0092):
 * handlers may run on different instances across steps, so nothing is
 * kept in module memory.
 */
import { StreamChat } from "stream-chat";
import { validateChatUiSpec } from "@hotelclaw/chat-ui";
import { chunkStreamText } from "@hotelclaw/chat-ui";
import { serviceClient } from "./supabase";

export type DeliveryRow = {
  id: string;
  property_id: string;
  channel_id: string;
  channel_type: "team" | "messaging";
  thread_key: string;
  turn_nonce: string | null;
  reply_candidate: string | null;
  ui_spec: unknown;
  delivered_nonce: string | null;
  kind: "chat" | "job";
  job_headline: string | null;
  pending_approval: unknown;
  /** Stream message id of the question this session is parked on (0098).
   *  A reply in THAT message's thread routes back here — the answer path
   *  for background jobs, whose `job:<uuid>` thread key no inbound message
   *  can ever produce. */
  question_message_id: string | null;
  /** Token usage accumulated over the turn's model steps (0113). */
  turn_usage: TurnUsage | null;
};

const ROW_COLUMNS =
  "id, property_id, channel_id, channel_type, thread_key, turn_nonce, reply_candidate, ui_spec, delivered_nonce, kind, job_headline, pending_approval, question_message_id, turn_usage";

/** eve's per-step usage shape (step.completed / session.waiting), summed
 *  over the turn, plus the model that ran it. */
export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  steps: number;
  modelId: string | null;
  /** The LAST step's input (fresh + cached) — i.e. how full the context
   *  window was when the turn ended. The sums above are what the turn
   *  spent; this is what the Context meter reads. */
  contextTokens: number;
};

/** One entry of `pending_approval.requests` as stamped by the eve channel's
 *  `input.requested` handler. */
export type PendingRequest = {
  toolName?: string;
  /** The gated tool's arguments — the payload an action preview must show. */
  input?: unknown;
  callId?: string | null;
  /** eve's request discriminator: question | tool-approval | session-limit. */
  kind?: string | null;
  prompt?: string | null;
  requestId?: string | null;
  display?: string | null;
  allowFreeform?: boolean;
  options?: Array<{
    id: string;
    label: string;
    description: string | null;
    /** eve option styling hint: default | primary | danger. */
    style?: string | null;
  }>;
};

/**
 * The agent asking the USER something, as opposed to a tool-approval park.
 *
 * eve routes both through `input.requested`; `display` is the discriminator
 * ("confirmation" = approval, "text"/"select" = question). A question with no
 * `prompt` has nothing to render, so it doesn't count.
 */
export function pendingQuestions(row: DeliveryRow): PendingRequest[] {
  const approval = row.pending_approval as { requests?: unknown } | null;
  const requests = Array.isArray(approval?.requests)
    ? (approval.requests as PendingRequest[])
    : [];
  return requests.filter((r) => typeof r.prompt === "string" && r.prompt.trim());
}

/**
 * Readable one-line summary of what a gated tool is about to do, from its
 * arguments. This is the "action preview" half — the research consensus is
 * that a confirmation which doesn't show the actual payload isn't a
 * confirmation, it's a speed bump ("show the actual preview of the outcome").
 *
 * Deliberately shallow: pick the human-meaningful fields, cap the rest. The
 * model's own `prompt` carries the intent; this carries the specifics.
 */
function previewArgs(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 6)
    .map(([k, v]) => {
      const text =
        typeof v === "string"
          ? v
          : Array.isArray(v)
            ? `${v.length} item${v.length === 1 ? "" : "s"}`
            : typeof v === "object"
              ? "…"
              : String(v);
      const trimmed = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      return `• ${k.replace(/_/g, " ")}: ${trimmed}`;
    });
  return entries.join("\n");
}

/**
 * Human labels for the "AI is thinking" progress line, keyed by tool name.
 *
 * Two forms per tool:
 *  - `base`  — what it's doing, with no subject ("Searching documents").
 *  - `detail` — the same step WITH the subject, `{}` standing in for it
 *    ("Searching documents for “freezer SOP”").
 *
 * The detail form is what makes the feed honest: "Looking through documents…"
 * for 40s tells the reader nothing they can check, while "Reading “Freezer
 * SOP”…" is a claim they can verify against the answer. Subjects come from the
 * tool's OWN arguments (see ACTIVITY_DETAIL_ARGS) or, when the argument is
 * only an id, from a title lookup (ACTIVITY_ID_LOOKUPS).
 *
 * Only the verbs worth spelling out — anything unmapped falls back to the
 * de-underscored tool name, so a new catalog tool degrades to something
 * readable ("search chat messages…") instead of nothing.
 */
const TOOL_ACTIVITY: Record<string, { base: string; detail?: string }> = {
  read_document: { base: "Reading a document", detail: "Reading “{}”" },
  list_documents: {
    base: "Looking through documents",
    detail: "Looking for documents matching “{}”",
  },
  search_documents: {
    base: "Searching documents",
    detail: "Searching documents for “{}”",
  },
  create_document: {
    base: "Writing a new document",
    detail: "Writing a new document, “{}”",
  },
  update_document: { base: "Writing", detail: "Writing to “{}”" },
  rename_document: { base: "Renaming a document", detail: "Renaming a document to “{}”" },
  archive_document: { base: "Archiving a document", detail: "Archiving “{}”" },
  restore_document_revision: {
    base: "Restoring a document",
    detail: "Restoring an earlier version of “{}”",
  },
  read_sheet: { base: "Reading a spreadsheet", detail: "Reading the “{}” spreadsheet" },
  update_sheet_cells: {
    base: "Updating a spreadsheet",
    detail: "Updating the “{}” spreadsheet",
  },
  property__search: {
    base: "Searching property memory",
    detail: "Searching property memory for “{}”",
  },
  property__remember: {
    base: "Saving to property memory",
    detail: "Remembering: {}",
  },
  property__forget: { base: "Retiring a memory" },
  person__search: { base: "Checking your notes", detail: "Checking your notes for “{}”" },
  person__remember: { base: "Noting a preference", detail: "Noting: {}" },
  person__forget: { base: "Retiring a note" },
  search_tasks: { base: "Searching tasks", detail: "Searching tasks for “{}”" },
  list_open_tasks: { base: "Checking open tasks" },
  update_task: { base: "Updating a task", detail: "Updating “{}”" },
  create_task: { base: "Creating a task", detail: "Creating the task “{}”" },
  create_project: { base: "Creating a project", detail: "Creating the project “{}”" },
  delete_task: { base: "Deleting a task", detail: "Deleting “{}”" },
  escalate_task: { base: "Escalating a task", detail: "Escalating “{}”" },
  render_ui: { base: "Putting together a summary" },
  search_chat_messages: {
    base: "Searching the channel history",
    detail: "Searching the channel history for “{}”",
  },
  start_background_job: {
    base: "Starting a background job",
    detail: "Starting a background job: {}",
  },
  check_availability: { base: "Checking availability", detail: "Checking availability for {}" },
  list_meetings: { base: "Checking the calendar" },
  schedule_meeting: { base: "Scheduling a meeting", detail: "Scheduling “{}”" },
  update_meeting: { base: "Updating a meeting", detail: "Updating the meeting “{}”" },
  cancel_meeting: { base: "Cancelling a meeting", detail: "Cancelling “{}”" },
  list_forms: { base: "Checking forms" },
  create_form: { base: "Building a form", detail: "Building the form “{}”" },
  set_form_status: { base: "Publishing a form", detail: "Publishing “{}”" },
  share_form_to_channel: { base: "Sharing a form", detail: "Sharing the form “{}”" },
  get_form_response_summaries: {
    base: "Reading form responses",
    detail: "Reading responses to “{}”",
  },
  read_resource: { base: "Reading an attached document", detail: "Reading “{}”" },
  get_org_chart: { base: "Checking the org chart" },
  list_workflows: { base: "Checking workflows" },
  trigger_workflow: { base: "Running a workflow", detail: "Running the “{}” workflow" },
  send_notification: { base: "Sending a notification", detail: "Notifying {}" },
  post_to_channel: { base: "Posting to another channel" },
  guest_conversation_insights: { base: "Reviewing guest conversations" },
  get_insight_brief: { base: "Reading the insights brief" },
  get_weekly_report: { base: "Reading the weekly report", detail: "Reading the {} weekly report" },
  list_handovers: { base: "Checking handovers" },
  ask_question: { base: "Working out what to ask" },
  load_skill: { base: "Loading a skill", detail: "Loading the {} skill" },
  delegate_task: { base: "Delegating the work", detail: "Delegating: {}" },
  subagent: { base: "Handing off to a subagent", detail: "Handing off to a subagent: {}" },
};

/**
 * Arguments that already carry a human-readable subject, per tool, in priority
 * order. First non-empty string wins.
 */
const ACTIVITY_DETAIL_ARGS: Record<string, string[]> = {
  // eve's load-skill action carries `{ name }` (docs/concepts/built-in-tools)
  // — the old `skill` key never matched, so every load read as a bare
  // "Loading a skill…".
  load_skill: ["name", "skill"],
  search_documents: ["query"],
  search_tasks: ["query"],
  search_chat_messages: ["query"],
  property__search: ["query"],
  property__remember: ["content"],
  person__search: ["query"],
  person__remember: ["content"],
  list_documents: ["title_contains"],
  create_document: ["title"],
  update_document: ["new_title"],
  rename_document: ["new_title"],
  create_task: ["title"],
  create_project: ["name"],
  schedule_meeting: ["title"],
  create_form: ["title"],
  check_availability: ["service_name"],
  send_notification: ["person_name", "team_name"],
  trigger_workflow: ["workflow_name"],
  start_background_job: ["headline"],
  get_weekly_report: ["audience"],
  delegate_task: ["headline", "title", "brief"],
  subagent: ["description", "message"],
};

/**
 * Tools whose only subject is an id — resolve it to the record's title so the
 * feed says "Reading “Freezer SOP”" rather than "Reading" (or, worse, a uuid).
 * One indexed point-read per step, property-scoped like every other runtime
 * query, and fail-soft: no row, no detail, generic label.
 */
const ACTIVITY_ID_LOOKUPS: Record<string, { arg: string; table: string }> = {
  read_document: { arg: "document_id", table: "documents" },
  update_document: { arg: "document_id", table: "documents" },
  archive_document: { arg: "document_id", table: "documents" },
  restore_document_revision: { arg: "document_id", table: "documents" },
  read_resource: { arg: "document_id", table: "documents" },
  read_sheet: { arg: "document_id", table: "documents" },
  update_sheet_cells: { arg: "document_id", table: "documents" },
  update_task: { arg: "task_id", table: "tasks" },
  delete_task: { arg: "task_id", table: "tasks" },
  escalate_task: { arg: "task_id", table: "tasks" },
  update_meeting: { arg: "meeting_id", table: "meetings" },
  cancel_meeting: { arg: "meeting_id", table: "meetings" },
  set_form_status: { arg: "form_id", table: "forms" },
  share_form_to_channel: { arg: "form_id", table: "forms" },
  get_form_response_summaries: { arg: "form_id", table: "forms" },
};

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Append one step to the turn's activity feed (migration 0096) AND set it as
 * the current label. The feed is what the chat shows as a timestamped list
 * while the turn runs and keeps as an expandable disclosure afterwards; the
 * label is the single-line "right now" state the indicator already reads.
 *
 * INSERT, never read-modify-write: handlers run as durable workflow steps and
 * parallel tool batches would race an array append.
 *
 * Label-only form (kind `thinking`); `recordStep` below is the structured
 * form every action / task / reasoning row uses since 0113.
 */
export async function recordActivity(
  row: DeliveryRow,
  label: string,
): Promise<void> {
  await setLiveActivity(row, label);
  if (!row.turn_nonce) return;

  // Collapse consecutive repeats. Parallel tool batches legitimately emit the
  // same label twice in a row ("Reading…" for two read_document batches);
  // as a permanent record that just reads as stutter.
  const { data: last } = await serviceClient()
    .from("channel_bot_activity")
    .select("label")
    .eq("channel_id", row.channel_id)
    .eq("thread_key", row.thread_key)
    .eq("turn_nonce", row.turn_nonce)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.label === label) return;

  const { error } = await serviceClient().from("channel_bot_activity").insert({
    property_id: row.property_id,
    channel_id: row.channel_id,
    thread_key: row.thread_key,
    turn_nonce: row.turn_nonce,
    label,
    kind: "thinking",
  });
  if (error) {
    // Cosmetic surface — never let it break a turn.
    console.error("[channel-delivery] activity insert failed", error.message);
  }
}

/**
 * Set the live "right now" label WITHOUT appending to the feed.
 *
 * For states that are real progress but not a step worth recording — chiefly
 * "Working on it" between a tool returning and the model's next move, which
 * fires once per tool RESULT and would otherwise fill the permanent record
 * with stutter.
 */
export async function setLiveActivity(
  row: DeliveryRow,
  label: string,
): Promise<void> {
  await updateSessionRow(row.id, { turn_activity: label });
}

/** The step kinds a turn trace can hold (0113). */
export type StepKind =
  | "thinking"
  | "reasoning"
  | "tool"
  | "skill"
  | "subagent"
  | "task"
  | "question"
  | "approval"
  | "waiting";

export type StepStatus = "running" | "completed" | "failed" | "rejected" | "cancelled";

/** Bound a value for the trace columns: strings clipped, objects
 *  re-serialised with their long strings clipped, everything under ~4KB.
 *  The trace is a reading aid — the full payload stays in eve's own
 *  session log. */
export function clipForTrace(value: unknown, maxChars = 4000): unknown {
  if (value === null || value === undefined) return null;
  const clipString = (s: string, n: number) =>
    s.length > n ? `${s.slice(0, n - 1)}…` : s;
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return clipString(v, 600);
    if (typeof v !== "object" || v === null) return v;
    if (depth > 4) return "…";
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v).slice(0, 40)) out[k] = walk(x, depth + 1);
    return out;
  };
  const bounded = walk(value, 0);
  const text = JSON.stringify(bounded);
  if (text && text.length > maxChars) {
    return typeof value === "string"
      ? clipString(value, maxChars)
      : { _truncated: true, preview: clipString(text, maxChars) };
  }
  return bounded;
}

/** First sentence of a result, the way eve's task card summarises "how it
 *  ended" (slack.mdx: "the first sentence of the result … cut to about 100
 *  characters"). */
export function firstSentence(value: unknown, max = 120): string | null {
  const text =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : value === undefined || value === null
          ? ""
          : String(value);
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  const sentence = m ? m[1] : flat;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/**
 * Structured step row (0113): one per action / task / reasoning block /
 * park. Sets the live label too unless `silent`. INSERT-only like
 * recordActivity; settlement is a targeted UPDATE by call/task id.
 */
export async function recordStep(
  row: DeliveryRow,
  step: {
    kind: StepKind;
    label: string;
    callId?: string | null;
    taskId?: string | null;
    toolName?: string | null;
    input?: unknown;
    detail?: string | null;
    status?: StepStatus;
    /** Don't advance the live label (e.g. a second action in a batch). */
    silent?: boolean;
  },
): Promise<void> {
  if (!step.silent) await setLiveActivity(row, step.label);
  if (!row.turn_nonce) return;
  const { error } = await serviceClient().from("channel_bot_activity").insert({
    property_id: row.property_id,
    channel_id: row.channel_id,
    thread_key: row.thread_key,
    turn_nonce: row.turn_nonce,
    label: step.label,
    kind: step.kind,
    call_id: step.callId ?? null,
    task_id: step.taskId ?? null,
    tool_name: step.toolName ?? null,
    input: step.input === undefined ? null : clipForTrace(step.input),
    detail: step.detail ?? null,
    status: step.status ?? "running",
  });
  if (error) {
    console.error("[channel-delivery] step insert failed", error.message);
  }
}

/** Close a running step row (by eve call id or task id) with how it ended. */
export async function settleStep(
  row: DeliveryRow,
  key: { callId?: string | null; taskId?: string | null },
  outcome: {
    status: StepStatus;
    output?: unknown;
    detail?: string | null;
    /** A `label.complete` projection replaces the start label. */
    label?: string | null;
  },
): Promise<void> {
  if (!row.turn_nonce) return;
  if (!key.callId && !key.taskId) return;
  let query = serviceClient()
    .from("channel_bot_activity")
    .update({
      status: outcome.status,
      settled_at: new Date().toISOString(),
      ...(outcome.output === undefined ? {} : { output: clipForTrace(outcome.output) }),
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      ...(outcome.label ? { label: outcome.label } : {}),
    })
    .eq("channel_id", row.channel_id)
    .eq("thread_key", row.thread_key)
    .eq("turn_nonce", row.turn_nonce);
  query = key.callId ? query.eq("call_id", key.callId) : query.eq("task_id", key.taskId!);
  const { error } = await query;
  if (error) {
    console.error("[channel-delivery] step settle failed", error.message);
  }
}

/** Sum a model step's usage into the turn (eve step.completed). */
export async function accumulateUsage(
  row: DeliveryRow,
  usage: Partial<Record<"inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsd", number | null | undefined>> | null | undefined,
  modelId?: string | null,
): Promise<void> {
  const prior: TurnUsage = row.turn_usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    steps: 0,
    modelId: null,
    contextTokens: 0,
  };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const next: TurnUsage = {
    inputTokens: prior.inputTokens + n(usage?.inputTokens),
    outputTokens: prior.outputTokens + n(usage?.outputTokens),
    cacheReadTokens: prior.cacheReadTokens + n(usage?.cacheReadTokens),
    cacheWriteTokens: prior.cacheWriteTokens + n(usage?.cacheWriteTokens),
    costUsd:
      typeof usage?.costUsd === "number"
        ? (prior.costUsd ?? 0) + usage.costUsd
        : prior.costUsd,
    steps: prior.steps + (usage ? 1 : 0),
    modelId: modelId ?? prior.modelId,
    contextTokens: usage
      ? n(usage.inputTokens) + n(usage.cacheReadTokens) + n(usage.cacheWriteTokens)
      : prior.contextTokens ?? 0,
  };
  await updateSessionRow(row.id, { turn_usage: next });
}

/** The turn's steps, oldest first, for stamping onto the delivered message. */
export async function turnActivitySteps(
  row: DeliveryRow,
): Promise<Array<{ label: string; at: string }>> {
  if (!row.turn_nonce) return [];
  const { data } = await serviceClient()
    .from("channel_bot_activity")
    .select("label, created_at, kind")
    .eq("channel_id", row.channel_id)
    .eq("thread_key", row.thread_key)
    .eq("turn_nonce", row.turn_nonce)
    .order("created_at", { ascending: true })
    .limit(40);
  // Mobile's `eve_steps` reader shows a flat list of labels — reasoning
  // blocks and park rows aren't steps it should count.
  return (data ?? [])
    .filter((r) => !["reasoning", "question", "approval"].includes(r.kind as string))
    .map((r) => ({ label: r.label, at: r.created_at }));
}

/** One requested action, reduced to what a progress label needs. */
export type ActivityAction = { toolName: string; input?: unknown };

/** Trim a subject to something that fits one line of chat. */
function clipSubject(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/**
 * The human subject of one action: a readable argument if the tool has one,
 * else the title behind an id argument, else nothing.
 */
async function activitySubject(
  action: ActivityAction,
  propertyId: string,
): Promise<string | null> {
  const input =
    action.input && typeof action.input === "object"
      ? (action.input as Record<string, unknown>)
      : {};

  for (const key of ACTIVITY_DETAIL_ARGS[action.toolName] ?? []) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return clipSubject(value);
  }

  const lookup = ACTIVITY_ID_LOOKUPS[action.toolName];
  if (!lookup) return null;
  const id = input[lookup.arg];
  if (typeof id !== "string" || !UUID_RX.test(id)) return null;

  try {
    const { data } = await serviceClient()
      .from(lookup.table)
      .select("title")
      .eq("id", id)
      .eq("property_id", propertyId)
      .maybeSingle();
    const title = (data as { title?: unknown } | null)?.title;
    return typeof title === "string" && title.trim() ? clipSubject(title) : null;
  } catch {
    // Cosmetic surface — a lookup failure just costs the detail.
    return null;
  }
}

/**
 * One progress label for a batch of requested actions.
 *
 * The label names the SUBJECT wherever one can be known — which document,
 * which skill, which search terms — because a step the reader can't check
 * ("Looking through documents…") is barely more informative than a spinner.
 * A mixed or repeated batch reports the first action plus a "+N more" tail;
 * the point is an honest moving sign of life, not an audit trail (the full
 * per-step list is the disclosure under the delivered reply).
 */
export async function activityLabel(
  actions: ActivityAction[],
  propertyId: string,
): Promise<string | null> {
  const known = actions.filter((a) => a && typeof a.toolName === "string" && a.toolName);
  if (known.length === 0) return null;

  const first = known[0];
  const spec = TOOL_ACTIVITY[first.toolName];
  const base =
    spec?.base ??
    first.toolName.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const subject = await activitySubject(first, propertyId);
  const head =
    subject && spec?.detail
      ? spec.detail.replace("{}", subject)
      : subject && !spec
        ? `${base}: ${subject}`
        : base;

  const rest = known.length - 1;
  return rest > 0 ? `${head} +${rest} more…` : `${head}…`;
}

/**
 * Render a parked request as chat text.
 *
 * Two shapes, one surface:
 *  - question (display text/select) — the prompt plus numbered options.
 *  - APPROVAL (display "confirmation") — an action preview: what the bot is
 *    about to do, with the actual arguments, then Approve/Deny.
 *
 * Approvals used to be filtered out here on the assumption the fleet
 * Approvals inbox would show them — but that inbox reads `bot_chat_sessions`
 * (pod bots only), so a channel-bot approval had NO surface at all and the
 * turn fell through to the ⚠️. The gated tools (archive_document,
 * delete_task) were therefore un-approvable from chat.
 */
function renderQuestion(request: PendingRequest): string {
  const prompt = (request.prompt ?? "").trim();
  const options = request.options ?? [];
  const isApproval = request.display === "confirmation";

  const head = isApproval
    ? [
        `⚠️ **Approval needed** — I'm about to run \`${request.toolName ?? "an action"}\`.`,
        "",
        prompt,
        previewArgs(request.input) ? `\n${previewArgs(request.input)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : prompt;

  if (options.length === 0) return head;
  const lines = options.map(
    (o, i) => `${i + 1}. **${o.label}**${o.description ? ` — ${o.description}` : ""}`,
  );
  // ≥2 options ⇒ deliverReply also ships a tappable ai_ui Options card
  // (same threshold, keep in sync) — the hint offers the tap first, and the
  // numbered list stays as the fallback for surfaces without the card.
  const hasCard = options.length >= 2;
  // Both chat clients render the Options card (web: ai-elements Suggestion /
  // Confirmation; mobile: AiUiAttachment chips), so the numbered list would
  // only duplicate the chips. It stays for the <2-option case, where no card
  // ships and typing the option is the only way to answer.
  if (hasCard) {
    const hint = isApproval
      ? "_Nothing happens until you decide._"
      : request.allowFreeform
        ? "_Pick one below, or answer in your own words._"
        : "_Pick one below._";
    return [head, "", hint].join("\n");
  }
  const hint = isApproval
    ? hasCard
      ? "_Tap an option to decide — or reply with a number or the option name. Nothing happens until you do._"
      : "_Reply with a number or the option name to decide. Nothing happens until you do._"
    : request.allowFreeform
      ? hasCard
        ? "_Tap an option below, or answer in your own words._"
        : "_Reply with a number, or answer in your own words._"
      : hasCard
        ? "_Tap an option below, or reply with a number._"
        : "_Reply with a number or the option name._";
  return [head, "", ...lines, "", hint].join("\n");
}

/** Resolve the session row for an eve session id. Retries briefly: the web
 * glue upserts the row right after the 202, but the first runtime event can
 * race it by a few hundred ms. */
export async function findSessionRow(
  eveSessionId: string,
  { retries = 3, delayMs = 400 }: { retries?: number; delayMs?: number } = {},
): Promise<DeliveryRow | null> {
  for (let attempt = 0; ; attempt++) {
    const { data } = await serviceClient()
      .from("channel_bot_sessions")
      .select(ROW_COLUMNS)
      .eq("eve_session_id", eveSessionId)
      .maybeSingle();
    if (data) return data as DeliveryRow;
    if (attempt >= retries) return null;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function updateSessionRow(
  rowId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await serviceClient()
    .from("channel_bot_sessions")
    .update(patch)
    .eq("id", rowId);
  if (error) {
    console.error("[channel-delivery] row update failed", rowId, error.message);
  }
}

function streamServer(): StreamChat | null {
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const secret = process.env.STREAM_API_SECRET;
  if (!apiKey || !secret) return null;
  return StreamChat.getInstance(apiKey, secret, { timeout: 15_000 });
}

function botUserId(): string {
  return process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai";
}

const ROOT_THREAD_KEY = "_root";

/** Background-job rows carry a synthetic `job:<id>` thread key — they
 * deliver top-level into the origin channel, never into a thread. */
function deliveryParentId(row: DeliveryRow): string | null {
  if (row.kind === "job") return null;
  return row.thread_key === ROOT_THREAD_KEY ? null : row.thread_key;
}

/**
 * Post the accumulated turn reply to the Stream channel. Idempotent twice
 * over: the caller gates on delivered_nonce, and the Stream message id is
 * deterministic per nonce so a replayed post dedupes server-side.
 */
export async function deliverReply(row: DeliveryRow): Promise<void> {
  const server = streamServer();
  if (!server) {
    console.error("[channel-delivery] Stream not configured — reply stranded", {
      channelId: row.channel_id,
    });
    return;
  }
  const channel = server.channel(row.channel_type, row.channel_id);
  const parentId = deliveryParentId(row);
  const botId = botUserId();
  // No typing.stop: the web no longer sends typing.start — the client's
  // thinking row watches the DB turn claim instead (spans the whole turn).

  // A turn that parks on a question produces NO message text — the question
  // lives in the park payload. Append it below whatever text the turn did
  // produce: the prod failure had the model post a "I have a few quick
  // questions!" preamble and then lose the questions themselves.
  const questions = pendingQuestions(row);
  const isQuestionPark = questions.length > 0;

  // Retire a previous question's anchor up front, so every exit path below
  // (ui-only turn, empty turn, a send that throws) leaves a session that is
  // no longer waiting with no route for stray replies to resume it.
  if (!isQuestionPark && row.question_message_id) {
    await updateSessionRow(row.id, { question_message_id: null });
  }

  const rawText = (row.reply_candidate ?? "").trim();
  // A parked job has NOT finished — labelling its question "✅ finished"
  // (the old unconditional prefix) told the reader the work was done and
  // buried the thing blocking it.
  const replyText =
    row.kind === "job" && row.job_headline
      ? isQuestionPark
        ? [`⏸️ **${row.job_headline}** — I need one thing from you:`, rawText]
            .filter(Boolean)
            .join("\n\n")
        : rawText
          ? `✅ **${row.job_headline}** — finished:\n\n${rawText}`
          : rawText
      : rawText;

  // render_ui spec was validated + link-rewritten by the tool runtime-side;
  // revalidate defensively before attaching (same discipline the web glue
  // applied).
  let attachments:
    | Array<{
        type: string;
        spec: unknown;
        reply_to_self?: boolean;
        park_request_id?: string | null;
      }>
    | undefined;
  if (row.ui_spec) {
    const validated = validateChatUiSpec(row.ui_spec);
    if (validated.ok) attachments = [{ type: "ai_ui", spec: validated.spec }];
  }

  // Tappable park options (2026-08-27): a question park with ≥2 real options
  // ALSO ships an ai_ui Options card — the same quick-reply chips the model
  // can render deliberately via render_ui — so the reader taps instead of
  // typing "2". The numbered list stays in the text as the fallback for
  // surfaces without the card. A tap sends the option LABEL as the user's
  // own message, which the web answer parser already matches (label / id /
  // 1-based index), so the parse path needs no change. Job parks flag the
  // card `reply_to_self`: their answer must be a THREAD REPLY under this
  // very message — the only route back to a job session (0098) — and the
  // web sender honors the flag by threading the tap under the card's
  // message instead of posting at top level.
  if (isQuestionPark) {
    const optionCards: NonNullable<typeof attachments> = [];
    for (const request of questions) {
      const options = (request.options ?? []).slice(0, 6);
      if (options.length < 2) continue;
      const spec = {
        root: "options",
        elements: {
          options: {
            type: "Options",
            props: {
              options: options.map((o) => ({
                label: o.label.slice(0, 80),
                value: o.label.slice(0, 200),
                ...(o.description
                  ? { description: o.description.slice(0, 120) }
                  : {}),
              })),
            },
          },
        },
      };
      const validated = validateChatUiSpec(spec);
      if (!validated.ok) continue;
      optionCards.push({
        type: "ai_ui",
        spec: validated.spec,
        // Ties the card to its request so the web can render it as the
        // structured park control (and settle it on input.resolved)
        // instead of a generic quick-reply row.
        park_request_id: request.requestId ?? null,
        ...(row.kind === "job" ? { reply_to_self: true } : {}),
      });
    }
    if (optionCards.length > 0) {
      attachments = [...(attachments ?? []), ...optionCards];
    }
  }

  // A background job's question is answered by REPLYING IN ITS THREAD — the
  // job's `job:<uuid>` thread key is synthetic, so the message's parent id is
  // the only thing that can route an answer back to it (0098). Say so, or the
  // reader answers at top level and the job waits forever.
  const threadHint =
    isQuestionPark && row.kind === "job"
      ? "_Reply in this thread to answer — the job is paused until you do._"
      : "";
  const text = [replyText, ...questions.map(renderQuestion), threadHint]
    .filter(Boolean)
    .join("\n\n");

  // Activity feed (0096) travels WITH the reply as a custom field, so the
  // record of what the bot did outlives the transient thinking row and can be
  // opened later. Progressive disclosure: the client renders it collapsed.
  const steps = await turnActivitySteps(row);
  // The parked requests, structured (0113): the web renders them as
  // ai-elements Suggestion chips / Confirmation cards and settles them in
  // place when input.resolved stamps the outcome (see settleRequests).
  const parkedRequests = questions.map(toMessageRequest);
  const usage = row.turn_usage ?? null;

  if (!text) {
    if (attachments) {
      // UI-only turn: the model answered with a render_ui card and no prose.
      // Post the card rather than claiming the turn produced nothing.
      await channel
        .sendMessage({
          id: row.turn_nonce ? `eve-${row.turn_nonce}` : undefined,
          text: "",
          user_id: botId,
          ai_generated: true,
          attachments,
          ...(row.turn_nonce ? { eve_turn: row.turn_nonce } : {}),
          ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
        } as unknown as Parameters<typeof channel.sendMessage>[0])
        .catch((e) => console.error("[channel-delivery] ui-only post failed", e));
      return;
    }
    // Fail-loud contract: an empty turn is a bug, never silence.
    await channel
      .sendMessage({
        id: row.turn_nonce ? `eve-${row.turn_nonce}` : undefined,
        text: "⚠️ AI reply failed — the agent turn completed without producing a reply. Check the runtime logs.",
        user_id: botId,
        ai_generated: true,
        ...(row.turn_nonce ? { eve_turn: row.turn_nonce } : {}),
        ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
      } as unknown as Parameters<typeof channel.sendMessage>[0])
      .catch((e) => console.error("[channel-delivery] empty-turn notice failed", e));
    return;
  }

  // Stream SILENTLY DISCARDS messages past its text limit (~5KB): the API
  // call "succeeds" but the message never exists — a 19KB job report simply
  // vanished (2026-07-23). Long results are chunked: first chunk where the
  // reply belongs, continuation chunks as THREAD REPLIES under it. Chunk
  // ids stay deterministic per nonce, so replays still dedupe.
  const chunks = chunkStreamText(text);

  let rootMessageId: string | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = row.turn_nonce
      ? i === 0
        ? `eve-${row.turn_nonce}`
        : `eve-${row.turn_nonce}-${i + 1}`
      : undefined;
    const isRoot = i === 0;
    const chunkText =
      chunks.length > 1 && !isRoot
        ? `(${i + 1}/${chunks.length}) ${chunks[i]}`
        : chunks.length > 1
          ? `${chunks[i]}\n\n_(1/${chunks.length} — continues in this thread)_`
          : chunks[i];
    try {
      const sent = await channel.sendMessage({
        // Deterministic ids: Stream upserts on id, so a handler replay
        // cannot double-post the same turn.
        ...(chunkId ? { id: chunkId } : {}),
        text: chunkText,
        user_id: botId,
        ai_generated: true,
        // Turn marker — the chat client groups every message sharing an
        // `eve_turn` into ONE reply cluster (one avatar/name/timestamp),
        // however long the turn ran. Artifact cards posted mid-turn by the
        // write tools carry the same nonce, so a turn that wrote five docs
        // reads as one reply with five cards, not five separate replies.
        ...(row.turn_nonce ? { eve_turn: row.turn_nonce } : {}),
        // Steps behind this reply, root chunk only (see `steps`).
        ...(isRoot && steps.length > 0 ? { eve_steps: steps } : {}),
        ...(isRoot && parkedRequests.length > 0 ? { eve_requests: parkedRequests } : {}),
        ...(isRoot && usage ? { eve_usage: usage } : {}),
        ...(isRoot && attachments ? { attachments } : {}),
        ...(isRoot
          ? parentId
            ? { parent_id: parentId, show_in_channel: false }
            : {}
          : { parent_id: rootMessageId ?? undefined, show_in_channel: false }),
      } as unknown as Parameters<typeof channel.sendMessage>[0]);
      if (isRoot) rootMessageId = sent.message.id;
    } catch (err) {
      console.error("[channel-delivery] sendMessage failed", { chunk: i }, err);
      if (isRoot) return;
    }
  }

  // Anchor the question to the message it was posted as, so a reply in that
  // thread routes back to THIS session (0098).
  if (isQuestionPark && rootMessageId) {
    await updateSessionRow(row.id, { question_message_id: rootMessageId });
  }
}

/** The structured park payload stamped on the delivered message
 *  (`eve_requests`). Mirrors eve's InputRequest minus the raw action
 *  payload size — inputs are clipped for the same ~5KB reason the reply
 *  text is chunked. */
export type MessageRequest = {
  requestId: string;
  kind: "question" | "tool-approval" | "session-limit" | "unknown";
  prompt: string;
  display: string | null;
  allowFreeform: boolean;
  options: Array<{ id: string; label: string; description: string | null; style: string | null }>;
  action: { toolName: string; input: unknown } | null;
  /** Filled by settleRequests (input.resolved). */
  outcome: string | null;
  answer: string | null;
};

function toMessageRequest(request: PendingRequest): MessageRequest {
  const kind =
    request.kind === "question" ||
    request.kind === "tool-approval" ||
    request.kind === "session-limit"
      ? request.kind
      : request.display === "confirmation"
        ? "tool-approval"
        : "question";
  return {
    requestId: request.requestId ?? "",
    kind,
    prompt: (request.prompt ?? "").trim(),
    display: request.display ?? null,
    allowFreeform: request.allowFreeform === true,
    options: (request.options ?? []).slice(0, 6).map((o) => ({
      id: o.id,
      label: o.label.slice(0, 80),
      description: o.description ? o.description.slice(0, 120) : null,
      style: o.style ?? null,
    })),
    action:
      kind === "tool-approval" && request.toolName
        ? { toolName: request.toolName, input: clipForTrace(request.input, 1200) }
        : null,
    outcome: null,
    answer: null,
  };
}

/**
 * input.resolved: settle the delivered park in place — eve's reference
 * channel "retires" a resolved request (slack.mdx HITL: the card loses its
 * buttons and shows the answer). The Stream message is edited, not
 * re-posted: `partialUpdateMessage` on the question's anchor message
 * stamps outcome + answer onto each `eve_requests` entry, and the park
 * rows in the trace close with the same outcome.
 */
export async function settleRequests(
  row: DeliveryRow,
  resolutions: Array<{
    requestId: string;
    outcome: string;
    response?: { optionId?: string | null; text?: string | null } | null;
  }>,
): Promise<void> {
  if (resolutions.length === 0) return;
  // By the time eve emits input.resolved, the web glue has already opened
  // the RESUME turn: the row carries a fresh turn_nonce and a cleared
  // question_message_id. So the park is found by its own request id — the
  // trace row records the nonce it was delivered under, and the delivered
  // message id is deterministic from that nonce (`eve-<nonce>`).
  const server = streamServer();
  const touched = new Map<string, Array<(typeof resolutions)[number]>>();
  for (const r of resolutions) {
    const { data: park } = await serviceClient()
      .from("channel_bot_activity")
      .select("id, turn_nonce")
      .eq("channel_id", row.channel_id)
      .eq("thread_key", row.thread_key)
      .eq("call_id", `request:${r.requestId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!park) continue;
    const status: StepStatus =
      r.outcome === "answered" || r.outcome === "approved"
        ? "completed"
        : r.outcome === "denied" || r.outcome === "cancelled"
          ? "rejected"
          : "cancelled";
    await serviceClient()
      .from("channel_bot_activity")
      .update({
        status,
        settled_at: new Date().toISOString(),
        detail:
          r.response?.text?.trim() ||
          (r.response?.optionId ? `Chose ${r.response.optionId}` : r.outcome),
      })
      .eq("id", park.id);
    const list = touched.get(park.turn_nonce) ?? [];
    list.push(r);
    touched.set(park.turn_nonce, list);
  }

  if (!server) return;
  for (const [nonce, batch] of touched) {
    const messageId = `eve-${nonce}`;
    try {
      const { message } = await server.getMessage(messageId);
      const stamped = (message as unknown as { eve_requests?: unknown }).eve_requests;
      const existing = Array.isArray(stamped) ? (stamped as MessageRequest[]) : [];
      if (existing.length === 0) continue;
      const next = existing.map((req) => {
        const hit = batch.find((r) => r.requestId === req.requestId);
        if (!hit) return req;
        const chosen = hit.response?.optionId
          ? req.options.find((o) => o.id === hit.response?.optionId)?.label ??
            hit.response.optionId
          : hit.response?.text ?? null;
        return { ...req, outcome: hit.outcome, answer: chosen };
      });
      await server.partialUpdateMessage(
        messageId,
        { set: { eve_requests: next } } as unknown as Parameters<
          typeof server.partialUpdateMessage
        >[1],
        botUserId(),
      );
    } catch (err) {
      console.error("[channel-delivery] request settle failed", { messageId }, err);
    }
  }
}

/** Post the fail-loud error notice (session.failed handler). */
export async function deliverFailure(
  row: DeliveryRow,
  reason: string,
): Promise<void> {
  const server = streamServer();
  if (!server) return;
  const channel = server.channel(row.channel_type, row.channel_id);
  const parentId = deliveryParentId(row);
  const headline =
    row.kind === "job" && row.job_headline ? `**${row.job_headline}** — ` : "";
  await channel
    .sendMessage({
      text: `⚠️ ${headline}AI reply failed — eve session error: ${reason.slice(0, 300)}. Check the runtime logs.`,
      user_id: botUserId(),
      ai_generated: true,
      // Group the failure notice with whatever the turn already posted.
      ...(row.turn_nonce ? { eve_turn: row.turn_nonce } : {}),
      ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
    } as unknown as Parameters<typeof channel.sendMessage>[0])
    .catch((e) => console.error("[channel-delivery] failure notice failed", e));
}

/** Origin of this runtime's own eve HTTP routes (self-sends: queue drain,
 * background-job creation). Mirrors the web side's eveOrigin(). */
export function eveSelfOrigin(): string {
  if (process.env.EVE_INTERNAL_ORIGIN) return process.env.EVE_INTERNAL_ORIGIN;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://127.0.0.1:3000";
}

/** Service-bearer headers for a channel-bot session (self-sends). The
 * membership fallback matches the web glue: act as the sender when they're
 * a member, else the property's earliest owner/manager. */
export async function channelBotHeaders(input: {
  propertyId: string;
  channelId: string;
  senderId: string;
}): Promise<Record<string, string> | null> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  let actingUserId = input.senderId;
  const { data: membership } = await serviceClient()
    .from("memberships")
    .select("user_id")
    .eq("property_id", input.propertyId)
    .eq("user_id", actingUserId)
    .maybeSingle();
  if (!membership) {
    const { data: fallback } = await serviceClient()
      .from("memberships")
      .select("user_id")
      .eq("property_id", input.propertyId)
      .in("role", ["owner", "manager"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!fallback) return null;
    actingUserId = fallback.user_id;
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
    "x-hotelclaw-property": input.propertyId,
    "x-hotelclaw-user": actingUserId,
    "x-hotelclaw-bot": "hotelclaw",
    "x-hotelclaw-channel": input.channelId,
    "x-hotelclaw-sender": input.senderId,
  };
}

type QueuedMessage = {
  messageId: string;
  text: string;
  userId: string;
  userName: string | null;
  activationReason: string;
};

/**
 * The drain-on-park step (eve docs, execution-model-and-durability.md:
 * "keep your own per-session queue in the channel or app layer, then
 * deliver the next message after the session parks again"). Called from
 * the session.waiting handler: if messages queued up during the turn, start
 * the next turn with them immediately (coalesced); otherwise mark the turn
 * slot idle. Since eve 0.31 follow-ups are addressed by the durable session
 * id alone — there is no continuation token to carry.
 */
export async function drainQueueOrIdle(
  row: DeliveryRow,
  eveSessionId: string,
): Promise<void> {
  if (row.kind === "job") {
    // Jobs have no message queue — nothing routes to them by thread key. They
    // park either FINISHED or ON A QUESTION; both release the turn slot, and a
    // question park stays resumable through its `question_message_id` anchor
    // (the continuation token was stored by the caller just above).
    await updateSessionRow(row.id, { turn_state: "idle" });
    return;
  }

  const { data: queued } = await serviceClient()
    .from("channel_bot_queue")
    .select("id, message")
    .eq("channel_id", row.channel_id)
    .eq("thread_key", row.thread_key)
    .order("created_at", { ascending: true })
    .limit(10);
  const pending = (queued ?? []).map((r) => r.message as QueuedMessage);

  if (pending.length === 0) {
    await updateSessionRow(row.id, { turn_state: "idle" });
    return;
  }

  const headers = await channelBotHeaders({
    propertyId: row.property_id,
    channelId: row.channel_id,
    senderId: pending[0].userId,
  });
  if (!headers) {
    await updateSessionRow(row.id, { turn_state: "idle" });
    return;
  }

  const nextNonce = crypto.randomUUID();
  const turnMessage = [
    `[turn ${nextNonce} — internal marker, ignore]`,
    `[Activation: these messages arrived while you were working — answer them now, each one]`,
    pending
      .map((m) => `${m.userName ?? "A teammate"} says: ${m.text}`)
      .join("\n"),
  ].join("\n\n");

  // Open the accumulator for the drain turn BEFORE sending (same order the
  // web glue uses), so the first model step can't outrace the nonce.
  await updateSessionRow(row.id, {
    turn_nonce: nextNonce,
    reply_candidate: null,
    ui_spec: null,
    pending_approval: null,
    status: "idle",
    last_turn_at: new Date().toISOString(),
  });

  // Resume by session id; one retry covers the park-settle race
  // (409 session_not_ready right after the park commits).
  let sent = false;
  for (let attempt = 0; attempt < 2 && !sent; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(
      `${eveSelfOrigin()}/eve/v1/session/${encodeURIComponent(eveSessionId)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ message: turnMessage }),
        signal: AbortSignal.timeout(15_000),
      },
    ).catch(() => null);
    sent = !!response?.ok;
  }

  if (sent) {
    await serviceClient()
      .from("channel_bot_queue")
      .delete()
      .in("id", (queued ?? []).map((r) => r.id));
    console.log("[channel-delivery] drained queue into next turn", {
      channelId: row.channel_id,
      threadKey: row.thread_key,
      messages: pending.length,
    });
  } else {
    // Leave the queue for the web-side fallback drain (next trigger packs
    // leftovers into its turn) and free the slot.
    console.error("[channel-delivery] queue drain send failed — leaving queue", {
      channelId: row.channel_id,
      threadKey: row.thread_key,
    });
    await updateSessionRow(row.id, { turn_state: "idle" });
  }
}
