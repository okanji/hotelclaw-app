/**
 * The agent-turn vocabulary — ONE set of shapes and rules for rendering an
 * AI turn, shared by every surface that draws one: the web's shadcn/ui AI
 * Elements patterns (`apps/web/components/ai/agent-turn/*`), their React
 * Native twins (`apps/mobile/components/ai/*`) and the eve runtime, which
 * stamps these shapes onto delivered channel messages
 * (`apps/agent/agent/lib/channel-delivery.ts`).
 *
 * Pure by contract: no React, no network, no server-only imports — the
 * mobile bundle and the eve build both consume it as plain TypeScript.
 *
 * Two kinds of input become the same `TurnStep[]`:
 *  - rows of `channel_bot_activity` (migration 0113) for the channel bot —
 *    `parseTurnStep`;
 *  - the transcript reducer's items (`./transcript`) for eve sessions and
 *    the AI SDK UI-message parts the panel bots stream —
 *    `transcriptTurnSteps` / `panelTurnSteps`.
 * The renderers only ever see `TurnStep`, so a Tool row, a Thought row, a
 * Subagent row or a settled park reads the same in a channel reply, the
 * Assistant, an agent chat, the fleet viewer, the task panel and the phone.
 */
import type { AppArtifactAttachment } from "./index";
import type { AssistantItem, InputRequest, ToolCall } from "./transcript";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type TurnStepKind =
  | "thinking"
  | "reasoning"
  | "tool"
  | "skill"
  | "subagent"
  | "task"
  | "question"
  | "approval"
  | "waiting"
  | "step";

export type TurnStepStatus = "running" | "completed" | "failed" | "rejected" | "cancelled";

export type TurnStep = {
  id: string;
  kind: TurnStepKind;
  /** The runtime's start-tense label ("Reading “X”…") or a settled one. */
  label: string;
  callId: string | null;
  taskId: string | null;
  toolName: string | null;
  input: unknown;
  output: unknown;
  /** Reasoning text, how a task ended, an error, or a park's answer. */
  detail: string | null;
  status: TurnStepStatus;
  /** ISO time the step opened; "" when the source has no clock. */
  at: string;
  settledAt: string | null;
};

const KINDS = new Set<TurnStepKind>([
  "thinking",
  "reasoning",
  "tool",
  "skill",
  "subagent",
  "task",
  "question",
  "approval",
  "waiting",
  "step",
]);
const STATUSES = new Set<TurnStepStatus>([
  "running",
  "completed",
  "failed",
  "rejected",
  "cancelled",
]);

/** A `channel_bot_activity` row → a step; null when the row is unusable. */
export function parseTurnStep(row: Record<string, unknown>): TurnStep | null {
  if (typeof row.id !== "string" || typeof row.label !== "string") return null;
  const kind = KINDS.has(row.kind as TurnStepKind) ? (row.kind as TurnStepKind) : "step";
  const status = STATUSES.has(row.status as TurnStepStatus)
    ? (row.status as TurnStepStatus)
    : "completed";
  return {
    id: row.id,
    kind,
    label: row.label,
    callId: typeof row.call_id === "string" ? row.call_id : null,
    taskId: typeof row.task_id === "string" ? row.task_id : null,
    toolName: typeof row.tool_name === "string" ? row.tool_name : null,
    input: row.input ?? null,
    output: row.output ?? null,
    detail: typeof row.detail === "string" ? row.detail : null,
    status,
    at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    settledAt: typeof row.settled_at === "string" ? row.settled_at : null,
  };
}

/** Columns the trace needs — selected explicitly so a pre-0113 database
 *  fails loudly instead of silently rendering label-only rows. */
export const TURN_STEP_COLUMNS =
  "id, kind, label, call_id, task_id, tool_name, input, output, detail, status, created_at, settled_at";

/** Merge a realtime row into a live list (insert or settle-in-place). */
export function upsertTurnStep(steps: TurnStep[], next: TurnStep): TurnStep[] {
  const index = steps.findIndex((s) => s.id === next.id);
  if (index === -1) return [...steps, next];
  const copy = steps.slice();
  copy[index] = next;
  return copy;
}

/** The label-only summary the runtime stamps on a delivered reply
 *  (`eve_steps`): enough for the "N steps · 12s" line without a query. */
export type SummaryStep = { label: string; at: string };

export function isSummarySteps(value: unknown): value is SummaryStep[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (s) =>
        !!s &&
        typeof s === "object" &&
        typeof (s as SummaryStep).label === "string" &&
        typeof (s as SummaryStep).at === "string",
    )
  );
}

/** Lifecycle rows that say nothing a reader needs ("Thinking", "Working on it"). */
export const HIDDEN_LABELS = new Set(["Thinking", "Working on it"]);
/** Kinds that count as "a step" in the summary line. */
export const COUNTED_KINDS = new Set<TurnStepKind>([
  "tool",
  "skill",
  "subagent",
  "task",
  "step",
  "question",
  "approval",
]);

export function visibleSteps(steps: TurnStep[]): TurnStep[] {
  return steps.filter(
    (s) => !((s.kind === "thinking" || s.kind === "step") && HIDDEN_LABELS.has(s.label)),
  );
}

export type TraceSummary = {
  /** Steps worth counting (tools, skills, subagents, parks). */
  counted: number;
  failed: number;
  /** Only reasoning happened — the Thought row IS the trace. */
  reasoningOnly: boolean;
  /** Wall time between the first and last timestamp, formatted; null if unknown. */
  duration: string | null;
  /** "Worked through 3 steps, 1 failed" — the Chain of Thought summary. */
  title: string;
};

/** The figures behind the Chain of Thought summary line, from whichever
 *  source is richer: structured rows when loaded, else the label summary. */
export function traceSummary(
  steps: TurnStep[] | null,
  summary: SummaryStep[] | null | undefined,
  live: boolean,
): TraceSummary {
  const shown = steps ? visibleSteps(steps) : null;
  const counted = shown
    ? shown.filter((s) => COUNTED_KINDS.has(s.kind)).length
    : (summary ?? []).filter((s) => !HIDDEN_LABELS.has(s.label)).length;
  const failed = shown ? shown.filter((s) => s.status === "failed").length : 0;
  const reasoningOnly = shown ? counted === 0 && shown.some((s) => s.kind === "reasoning") : false;
  const times = (steps ?? [])
    .flatMap((s) => [s.at, s.settledAt])
    .concat((summary ?? []).map((s) => s.at))
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime())
    .filter((n) => !Number.isNaN(n));
  const duration =
    times.length >= 2 && !live ? formatDuration(Math.max(...times) - Math.min(...times)) : null;
  const title = `Worked through ${counted} step${counted === 1 ? "" : "s"}${
    failed > 0 ? `, ${failed} failed` : ""
  }`;
  return { counted, failed, reasoningOnly, duration, title };
}

export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 1000) return null;
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function stepDuration(step: TurnStep): string | null {
  if (!step.at || !step.settledAt) return null;
  return formatDuration(new Date(step.settledAt).getTime() - new Date(step.at).getTime());
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Human labels for tool calls, in the done tense — the transcript shows what
 * the agent DID ("Searched documents"), never what it called
 * (`search_documents`); the raw name and payload stay one click away. An
 * unmapped id falls back to a de-underscored sentence, so a newly granted
 * catalog tool reads acceptably before anyone touches this map.
 */
export const TOOL_LABELS: Record<string, string> = {
  // Tasks
  list_open_tasks: "Read open tasks",
  search_tasks: "Searched tasks",
  create_task: "Created a task",
  update_task: "Updated a task",
  delete_task: "Deleted a task",
  escalate_task: "Escalated a task",
  create_project: "Created a project",
  // Documents
  search_documents: "Searched documents",
  list_documents: "Listed documents",
  read_document: "Read a document",
  create_document: "Wrote a document",
  update_document: "Edited a document",
  rename_document: "Renamed a document",
  archive_document: "Archived a document",
  restore_document_revision: "Restored a revision",
  // Spreadsheets
  read_sheet: "Read a spreadsheet",
  update_sheet_cells: "Edited a spreadsheet",
  // Calendar + bookings
  list_meetings: "Checked the calendar",
  schedule_meeting: "Scheduled a meeting",
  update_meeting: "Updated a meeting",
  cancel_meeting: "Cancelled a meeting",
  list_bookings: "Checked bookings",
  create_booking: "Made a booking",
  update_booking_status: "Updated a booking",
  // Chat
  search_chat_messages: "Searched conversations",
  list_channels: "Listed channels",
  post_to_channel: "Posted to a channel",
  send_notification: "Sent a notification",
  // Forms + workflows
  list_forms: "Listed forms",
  get_form_response_summaries: "Read form responses",
  create_form: "Built a form",
  set_form_status: "Changed a form's status",
  share_form_to_channel: "Shared a form",
  list_workflows: "Listed workflows",
  trigger_workflow: "Ran a workflow",
  // Knowledge
  property__search: "Searched property memory",
  property__remember: "Saved to property memory",
  property__forget: "Retired a memory",
  person__search: "Checked your notes",
  person__remember: "Noted a preference",
  person__forget: "Retired a note",
  web_search: "Searched the web",
  web_fetch: "Read a page",
  eve__skill: "Loaded a skill",
  load_skill: "Loaded a skill",
  ask_question: "Asked a question",
  start_background_job: "Started a background job",
  // Reports + org
  get_insight_brief: "Read the intelligence brief",
  get_weekly_report: "Read the weekly report",
  list_handovers: "Read handovers",
  guest_conversation_insights: "Reviewed guest conversations",
  get_org_chart: "Read the org chart",
  // Presentation
  render_ui: "Prepared a view",
};

export function toolLabel(toolName: string): string {
  const known = TOOL_LABELS[toolName];
  if (known) return known;
  const words = toolName.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Tools whose whole point is the rendered card — their activity row would
 *  be noise sitting directly above the thing it describes. */
export const SILENT_TOOLS = new Set(["render_ui"]);

const PAST_OF: Record<string, string> = {
  Thinking: "Thought",
  Reading: "Read",
  Writing: "Wrote",
  Making: "Made",
  Running: "Ran",
  Putting: "Put",
  Getting: "Got",
  Sending: "Sent",
  Building: "Built",
  Handing: "Handed",
  Looking: "Looked",
  Drawing: "Drew",
};
const PRESENT_OF: Record<string, string> = Object.fromEntries(
  Object.entries(PAST_OF).map(([present, past]) => [past, present]),
);

/**
 * "Reading “Freezer SOP”…" → "Read “Freezer SOP”" — the runtime labels a
 * step as it STARTS (present tense, trailing ellipsis, the shape the live
 * status line wants); a settled line reads in the done tense, as the Tool
 * pattern's state table has it. A label without the ellipsis is already
 * settled (eve's own `label` projections, `toolLabel`) and is left alone.
 */
export function settledLabel(label: string): string {
  const trimmed = label.replace(/\s*\+\d+ more…?$/, "").trim();
  if (!trimmed.endsWith("…")) return trimmed;
  const base = trimmed.slice(0, -1).trim();
  const m = base.match(/^([A-Z][a-z]+ing)\b(.*)$/);
  if (!m) return base;
  const verb = m[1];
  const rest = m[2];
  const past =
    PAST_OF[verb] ??
    (() => {
      const stem = verb.slice(0, -3);
      if (/[^aeiou]y$/.test(stem)) return `${stem.slice(0, -1)}ied`;
      if (/e$/.test(stem)) return `${stem}d`;
      return `${stem}ed`;
    })();
  return `${past}${rest}`;
}

/** The label while the step runs: a start-tense label minus its ellipsis,
 *  or a done-tense label ("Searched tasks") turned present ("Searching tasks"). */
export function runningLabel(label: string): string {
  const trimmed = label.replace(/\s*\+\d+ more…?$/, "").trim();
  if (trimmed.endsWith("…")) return trimmed.slice(0, -1).trim();
  const m = trimmed.match(/^([A-Z][a-z]+)\b(.*)$/);
  if (!m) return trimmed;
  const verb = m[1];
  const rest = m[2];
  if (verb.endsWith("ing")) return trimmed;
  const present =
    PRESENT_OF[verb] ??
    (verb.endsWith("ied")
      ? `${verb.slice(0, -3)}ying`
      : verb.endsWith("ed")
        ? `${verb.slice(0, -2)}ing`
        : null);
  return present ? `${present}${rest}` : trimmed;
}

/** Lower-case the first letter for "Failed: searched tasks" style prefixes. */
export function lowerFirst(label: string): string {
  return label.replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/** Which glyph a step wants — resolved to lucide on the web, Ionicons on
 *  the phone, so both surfaces classify a tool the same way. */
export type StepGlyph =
  | "skill"
  | "agent"
  | "question"
  | "approval"
  | "web"
  | "memory"
  | "search"
  | "read"
  | "write"
  | "view"
  | "reasoning"
  | "tool";

export function stepGlyph(step: Pick<TurnStep, "toolName" | "kind">): StepGlyph {
  if (step.kind === "reasoning") return "reasoning";
  if (step.kind === "skill") return "skill";
  if (step.kind === "subagent" || step.kind === "task") return "agent";
  if (step.kind === "question") return "question";
  if (step.kind === "approval") return "approval";
  const name = step.toolName ?? "";
  if (/^web_(search|fetch)$/.test(name)) return "web";
  if (/^(property|person)__/.test(name)) return "memory";
  if (/^(search|list|get|check)_/.test(name) || name === "eve__search") return "search";
  if (/^read_/.test(name)) return "read";
  if (
    /^(create|update|write|rename|set|share|schedule|post|send|escalate|trigger|restore|archive|delete|cancel)_/.test(
      name,
    )
  )
    return "write";
  if (name === "render_ui") return "view";
  return "tool";
}

/** The title of a Tool / Subagent / park row in the state it is in. */
export function stepTitle(step: TurnStep, live: boolean): string {
  const running = step.status === "running" && live;
  // A step still "running" on a settled turn never reported back — the
  // Tool pattern's "input-available after the chat stops" case.
  const stranded = step.status === "running" && !live;
  const failed = step.status === "failed" || stranded;
  if (step.kind === "reasoning") return running ? "Thinking" : "Thought";
  if (step.kind === "task" || step.kind === "subagent") {
    const name = step.label.replace(/:\s*(working|done|completed|failed|cancelled)$/i, "");
    if (running) return `Running the ${name} subagent`;
    if (failed) return `Failed to run the ${name} subagent`;
    if (step.status === "cancelled") return `Stopped the ${name} subagent`;
    return `Ran the ${name} subagent`;
  }
  if (step.kind === "question" || step.kind === "approval") {
    const isApproval = step.kind === "approval";
    const answer = step.detail?.replace(/^Chose\s+/, "") ?? null;
    if (step.status === "running") {
      if (live) return isApproval ? "Waiting for approval" : "Waiting for an answer";
      return isApproval ? "Asked for approval" : "Asked a question";
    }
    if (isApproval) {
      if (step.status === "rejected") return "Not approved";
      if (step.status === "cancelled") return "Approval no longer needed";
      return "Approved";
    }
    if (step.status === "cancelled") return "Question withdrawn";
    return answer ? `Answered: ${answer}` : "Answered";
  }
  if (running) return runningLabel(step.label);
  if (step.status === "rejected") return `Not approved: ${lowerFirst(settledLabel(step.label))}`;
  if (failed) return `Failed: ${lowerFirst(settledLabel(step.label))}`;
  if (step.status === "cancelled") return settledLabel(step.label);
  return settledLabel(step.label);
}

// ---------------------------------------------------------------------------
// Sources (web search / fetch output)
// ---------------------------------------------------------------------------

export type SourceLink = { url: string; title: string };

/** Pages a web search / fetch returned — any `{url, title?}` object in the
 *  tool output, deduped by url. Anthropic's native search result shape is
 *  not pinned by eve, so this walks rather than assumes. */
export function extractSources(output: unknown): SourceLink[] {
  const found = new Map<string, string>();
  const walk = (v: unknown, depth: number) => {
    if (found.size >= 8 || depth > 5 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    const obj = v as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url : null;
    if (url && /^https?:\/\//.test(url) && !found.has(url)) {
      const title =
        typeof obj.title === "string" && obj.title.trim()
          ? obj.title.trim()
          : (() => {
              try {
                return new URL(url).hostname;
              } catch {
                return url;
              }
            })();
      found.set(url, title);
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(output, 0);
  return [...found].map(([url, title]) => ({ url, title }));
}

export function isWebTool(toolName: string | null): boolean {
  return /^web_(search|fetch)$/.test(toolName ?? "");
}

/** Stringify a payload for a code block. */
export function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Parks (questions, approvals, session limits)
// ---------------------------------------------------------------------------

export type ParkOption = {
  id: string;
  label: string;
  description: string | null;
  /** eve's `style` hint (primary / danger / default). */
  style?: string | null;
};

/**
 * A park the turn is (or was) held on. The transcript reducer's
 * `InputRequest` and the channel runtime's stamped `eve_requests` entry are
 * both this shape, so one set of controls answers either.
 */
export type ParkRequest = {
  requestId: string;
  kind: "question" | "tool-approval" | "session-limit" | "unknown";
  prompt: string;
  display: string | null;
  allowFreeform: boolean;
  options: ParkOption[];
  action: { toolName: string; input: unknown; callId?: string | null } | null;
  outcome: string | null;
  answer: string | null;
};

/** The channel runtime's name for the same shape (`eve_requests`). */
export type MessageRequest = ParkRequest;

export function isMessageRequests(value: unknown): value is ParkRequest[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (r) =>
        !!r &&
        typeof r === "object" &&
        typeof (r as ParkRequest).requestId === "string" &&
        Array.isArray((r as ParkRequest).options),
    )
  );
}

export const DEFAULT_APPROVAL_OPTIONS: ParkOption[] = [
  { id: "cancel", label: "Cancel", description: null, style: null },
  { id: "approve", label: "Approve", description: null, style: "primary" },
];

/** Does this option mean "go ahead"? Drives the filled-vs-outline button. */
export function isAffirmativeOption(option: ParkOption): boolean {
  const rx = /^(approve|continue|yes|allow|confirm|ok)/i;
  return rx.test(option.id) || rx.test(option.label);
}

/** The options a park offers, with the approval defaults when eve sent none. */
export function parkOptions(request: ParkRequest): ParkOption[] {
  if (request.options.length > 0) return request.options;
  if (request.kind === "tool-approval" || request.kind === "session-limit")
    return DEFAULT_APPROVAL_OPTIONS;
  return [];
}

/** The action in its imperative form ("archive document") — nothing was
 *  done, so the done-tense label would be a lie. */
export function parkActionName(request: ParkRequest): string {
  return (request.action?.toolName ?? "this action").replace(/_/g, " ");
}

/** The approval card's title: eve's own prompt ("Approve Archive document?")
 *  when it sent one, else a question built from the tool's label. */
export function parkTitle(request: ParkRequest): string {
  if (request.kind === "session-limit") return "Session budget reached";
  if (request.kind === "tool-approval") {
    return request.prompt || `Approve: ${parkActionName(request)}?`;
  }
  return request.prompt || "The assistant has a question";
}

export type ParkOutcome = "approved" | "denied" | "withdrawn" | "answered";

/** How a settled park ended, collapsed to the four states a line can show. */
export function parkOutcome(request: ParkRequest): ParkOutcome | null {
  const outcome = request.outcome ?? "";
  if (!outcome) return null;
  if (outcome === "ignored" || outcome === "invalid" || outcome === "expired") return "withdrawn";
  if (request.kind === "tool-approval" || request.kind === "session-limit") {
    if (outcome === "denied" || outcome === "cancelled") return "denied";
    return "approved";
  }
  return "answered";
}

/** The one line a settled park reads as. */
export function settledParkLabel(request: ParkRequest): string {
  const outcome = parkOutcome(request);
  const isApproval = request.kind === "tool-approval" || request.kind === "session-limit";
  if (isApproval) {
    if (outcome === "denied") return `Not approved: ${parkActionName(request)}`;
    if (outcome === "withdrawn") return "Approval no longer needed";
    return request.kind === "session-limit" ? "Continued" : `Approved: ${parkActionName(request)}`;
  }
  if (outcome === "withdrawn") return "Question withdrawn";
  const chosen = request.options.find((o) => o.id === request.answer)?.label ?? request.answer;
  return chosen ? `Answered: ${chosen}` : "Answered";
}

/** Up to five "key: value" lines previewing a gated action's input. */
export function parkInputLines(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 5)
    .map(([k, v]) => {
      const text =
        typeof v === "string"
          ? v
          : Array.isArray(v)
            ? `${v.length} item${v.length === 1 ? "" : "s"}`
            : typeof v === "object"
              ? "…"
              : String(v);
      return `${k.replace(/_/g, " ")}: ${text.length > 100 ? `${text.slice(0, 99)}…` : text}`;
    });
}

const APPROVAL_BLOCK_MARKER = "⚠️ **Approval needed**";

/** The approval block the runtime appends to the message text for clients
 *  without park controls is replaced by the Confirmation card wherever one
 *  renders, so the words never appear twice. */
export function displayReplyText(text: string, requests: ParkRequest[]): string {
  if (!requests.some((r) => r.kind === "tool-approval" || r.kind === "session-limit")) return text;
  const index = text.indexOf(APPROVAL_BLOCK_MARKER);
  return index >= 0 ? text.slice(0, index).trim() : text;
}

// ---------------------------------------------------------------------------
// Usage (the Context pattern)
// ---------------------------------------------------------------------------

/** Per-turn token usage stamped on the delivered message (`eve_usage`). */
export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  steps: number;
  modelId: string | null;
  /** The last step's input (fresh + cached): how full the window was. */
  contextTokens?: number;
};

export function isTurnUsage(value: unknown): value is TurnUsage {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TurnUsage).inputTokens === "number" &&
    typeof (value as TurnUsage).outputTokens === "number"
  );
}

/** The window is the model's, which the runtime does not send, so it is
 *  set from the model id (Claude: 200k; the `[1m]` variants: 1M). */
export function contextLimit(modelId: string | null): number {
  if (modelId && /\[1m\]|-1m\b/i.test(modelId)) return 1_000_000;
  return 200_000;
}

export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

export function shortModel(modelId: string | null): string | null {
  if (!modelId) return null;
  return modelId.replace(/^anthropic\//, "").replace(/-\d{8}$/, "");
}

export type ContextUsage = {
  limit: number;
  used: number;
  percent: number;
  model: string | null;
  rows: Array<{ label: string; value: string }>;
  footer: string | null;
};

/** Everything the Context pattern draws: the percent for the trigger, the
 *  bar, the token rows and the model / steps / cost footer. */
export function contextUsage(usage: TurnUsage): ContextUsage {
  const limit = contextLimit(usage.modelId);
  const used =
    usage.contextTokens && usage.contextTokens > 0
      ? usage.contextTokens
      : usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const percent = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
  const rows = [
    { label: "Input", value: formatTokens(usage.inputTokens) },
    { label: "Output", value: formatTokens(usage.outputTokens) },
    ...(usage.cacheReadTokens > 0
      ? [{ label: "Cache read", value: formatTokens(usage.cacheReadTokens) }]
      : []),
    ...(usage.cacheWriteTokens > 0
      ? [{ label: "Cache write", value: formatTokens(usage.cacheWriteTokens) }]
      : []),
  ];
  const model = shortModel(usage.modelId);
  const footer =
    model || usage.steps > 0 || usage.costUsd !== null
      ? `${usage.steps} step${usage.steps === 1 ? "" : "s"}${
          usage.costUsd !== null
            ? ` · $${usage.costUsd.toFixed(usage.costUsd < 0.1 ? 3 : 2)}`
            : ""
        }`
      : null;
  return { limit, used, percent, model, rows, footer };
}

// ---------------------------------------------------------------------------
// Artifacts: the records a turn wrote (documents, sheets, tasks)
// ---------------------------------------------------------------------------

const ARTIFACT_TOOLS: Record<
  string,
  { kind: AppArtifactAttachment["kind"]; action: string }
> = {
  create_document: { kind: "document", action: "created" },
  update_document: { kind: "document", action: "updated" },
  rename_document: { kind: "document", action: "updated" },
  restore_document_revision: { kind: "document", action: "updated" },
  update_sheet_cells: { kind: "sheet", action: "updated" },
  create_task: { kind: "task", action: "created" },
  update_task: { kind: "task", action: "updated" },
};

const PROPERTY_FROM_HREF = /^\/p\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\//i;

/**
 * The channel bot posts an `app_artifact` card the moment a write tool
 * starts (so people can watch the doc being written). An eve transcript
 * has no Stream to post to, so the same cards are DERIVED from the tool
 * results: a finished write that returned a record id + url becomes a
 * "done" artifact, and a write still running becomes a "writing" one —
 * the Assistant and the phone draw them with the same ArtifactCard.
 */
export function artifactsFromToolCalls(calls: ToolCall[]): AppArtifactAttachment[] {
  const out: AppArtifactAttachment[] = [];
  for (const call of calls) {
    const meta = ARTIFACT_TOOLS[call.toolName];
    if (!meta) continue;
    const input = (call.input ?? {}) as Record<string, unknown>;
    const output = (call.done && call.output && typeof call.output === "object"
      ? call.output
      : {}) as Record<string, unknown>;
    if (call.done && (call.error || typeof output.error === "string")) continue;
    const task = output.task as Record<string, unknown> | undefined;
    const href =
      typeof output.url === "string"
        ? output.url
        : typeof output.href === "string"
          ? output.href
          : null;
    const propertyId = href ? PROPERTY_FROM_HREF.exec(href)?.[1] : null;
    if (!propertyId) continue;
    const documentId =
      typeof output.document_id === "string"
        ? output.document_id
        : typeof input.document_id === "string"
          ? input.document_id
          : undefined;
    const taskId =
      typeof output.task_id === "string"
        ? output.task_id
        : task && typeof task.id === "string"
          ? task.id
          : typeof input.task_id === "string"
            ? input.task_id
            : undefined;
    const title =
      (typeof output.title === "string" && output.title) ||
      (task && typeof task.title === "string" && task.title) ||
      (typeof input.title === "string" && input.title) ||
      (typeof input.new_title === "string" && input.new_title) ||
      (meta.kind === "task" ? "Task" : meta.kind === "sheet" ? "Spreadsheet" : "Document");
    out.push({
      type: "app_artifact",
      kind: meta.kind,
      status: call.done ? "done" : "writing",
      title,
      property_id: propertyId,
      action: meta.action,
      ...(documentId ? { document_id: documentId } : {}),
      ...(taskId ? { task_id: taskId } : {}),
      ...(href ? { href } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Adapters: transcript items and panel-bot parts → steps
// ---------------------------------------------------------------------------

function requestStep(request: InputRequest | ParkRequest): TurnStep {
  const outcome = parkOutcome(request);
  const chosen = request.options.find((o) => o.id === request.answer)?.label ?? request.answer;
  return {
    id: `park-${request.requestId}`,
    kind: request.kind === "question" ? "question" : "approval",
    label: request.prompt || (request.kind === "question" ? "Question" : "Approval"),
    callId: null,
    taskId: null,
    toolName: request.action?.toolName ?? null,
    input: request.action?.input ?? null,
    output: null,
    detail: outcome === "answered" && chosen ? `Chose ${chosen}` : null,
    status:
      outcome === null
        ? "running"
        : outcome === "denied"
          ? "rejected"
          : outcome === "withdrawn"
            ? "cancelled"
            : "completed",
    at: "",
    settledAt: null,
  };
}

/**
 * An eve transcript turn → steps. The reducer keeps reasoning, tool calls,
 * subagent tasks and parks in separate lists (the event log does not
 * interleave them per call), so the order here is the order a turn runs
 * in: thinking, then the work, then the subagents, then what it asked.
 * Open parks are left out — their live controls render outside the trace
 * (Confirmation pattern); settled ones read as lines.
 */
export function transcriptTurnSteps(
  item: Pick<AssistantItem, "reasoning" | "toolCalls" | "tasks" | "requests">,
  options: { hideSilent?: boolean; running?: boolean } = {},
): TurnStep[] {
  const steps: TurnStep[] = [];
  item.reasoning.forEach((text, i) => {
    if (!text.trim()) return;
    steps.push({
      id: `reasoning-${i}`,
      kind: "reasoning",
      label: "Thinking",
      callId: null,
      taskId: null,
      toolName: null,
      input: null,
      output: null,
      detail: text,
      // Reasoning streams before the first tool call; once anything else
      // exists in the turn it has finished.
      status:
        options.running && i === item.reasoning.length - 1 && item.toolCalls.length === 0
          ? "running"
          : "completed",
      at: "",
      settledAt: null,
    });
  });
  for (const call of item.toolCalls) {
    // A silent tool (render_ui) hides only when it WORKED — a failed call
    // is the one row the reader needs to see.
    if (options.hideSilent !== false && SILENT_TOOLS.has(call.toolName) && !call.error) continue;
    steps.push({
      id: call.callId,
      kind: /^(eve__skill|load_skill)$/.test(call.toolName) ? "skill" : "tool",
      label: toolLabel(call.toolName),
      callId: call.callId,
      taskId: null,
      toolName: call.toolName,
      input: call.input ?? null,
      output: call.output ?? null,
      detail: call.error ?? null,
      status: !call.done ? "running" : call.error ? "failed" : "completed",
      at: "",
      settledAt: null,
    });
  }
  for (const task of item.tasks) {
    steps.push({
      id: task.taskId,
      kind: "task",
      label: task.name,
      callId: null,
      taskId: task.taskId,
      toolName: null,
      input: null,
      output: task.output ?? null,
      detail: task.error ?? null,
      status:
        task.status === "working"
          ? "running"
          : task.status === "completed"
            ? "completed"
            : task.status === "failed"
              ? "failed"
              : "cancelled",
      at: "",
      settledAt: null,
    });
  }
  for (const request of item.requests) {
    if (!request.outcome) continue;
    steps.push(requestStep(request));
  }
  return steps;
}

/** The AI SDK UI-message tool part, as both clients see it. */
export type PanelToolPart = {
  toolCallId: string;
  toolName: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** A panel bot's streamed message (reasoning + tool parts) → steps. */
export function panelTurnSteps(
  reasoning: Array<{ text: string; streaming: boolean }>,
  tools: PanelToolPart[],
  options: { hideSilent?: boolean } = {},
): TurnStep[] {
  const steps: TurnStep[] = [];
  reasoning.forEach((block, i) => {
    if (!block.text.trim()) return;
    steps.push({
      id: `reasoning-${i}`,
      kind: "reasoning",
      label: "Thinking",
      callId: null,
      taskId: null,
      toolName: null,
      input: null,
      output: null,
      detail: block.text,
      status: block.streaming ? "running" : "completed",
      at: "",
      settledAt: null,
    });
  });
  for (const part of tools) {
    if (options.hideSilent !== false && SILENT_TOOLS.has(part.toolName) && part.state !== "output-error") continue;
    steps.push({
      id: part.toolCallId,
      kind: "tool",
      label: toolLabel(part.toolName),
      callId: part.toolCallId,
      taskId: null,
      toolName: part.toolName,
      input: part.input ?? null,
      output: part.state === "output-available" ? (part.output ?? null) : null,
      detail: part.state === "output-error" ? (part.errorText ?? "The tool failed.") : null,
      status:
        part.state === "output-available"
          ? "completed"
          : part.state === "output-error"
            ? "failed"
            : "running",
      at: "",
      settledAt: null,
    });
  }
  return steps;
}
