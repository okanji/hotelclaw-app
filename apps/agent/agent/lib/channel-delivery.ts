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
import { chunkStreamText } from "@hotelclaw/brain";
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
};

const ROW_COLUMNS =
  "id, property_id, channel_id, channel_type, thread_key, turn_nonce, reply_candidate, ui_spec, delivered_nonce, kind, job_headline, pending_approval";

/** One entry of `pending_approval.requests` as stamped by the eve channel's
 *  `input.requested` handler. */
export type PendingRequest = {
  toolName?: string;
  /** The gated tool's arguments — the payload an action preview must show. */
  input?: unknown;
  prompt?: string | null;
  requestId?: string | null;
  display?: string | null;
  allowFreeform?: boolean;
  options?: Array<{ id: string; label: string; description: string | null }>;
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
 * Only the verbs worth spelling out — anything unmapped falls back to the
 * de-underscored tool name, so a new catalog tool degrades to something
 * readable ("search chat messages…") instead of nothing.
 */
const TOOL_ACTIVITY: Record<string, string> = {
  read_document: "Reading",
  list_documents: "Looking through documents",
  search_documents: "Searching documents",
  create_document: "Writing a new document",
  update_document: "Writing",
  archive_document: "Archiving a document",
  restore_document_revision: "Restoring a document",
  read_sheet: "Reading a spreadsheet",
  update_sheet_cells: "Updating a spreadsheet",
  brain_search: "Searching the knowledge brain",
  brain_think: "Thinking it through with the brain",
  brain_get: "Reading from the knowledge brain",
  brain_list: "Browsing the knowledge brain",
  brain_capture: "Saving to the knowledge brain",
  search_tasks: "Searching tasks",
  list_open_tasks: "Checking open tasks",
  update_task: "Updating a task",
  create_task: "Creating a task",
  create_project: "Creating a project",
  delete_task: "Deleting a task",
  escalate_task: "Escalating a task",
  render_ui: "Putting together a summary",
  search_chat_messages: "Searching the channel history",
  start_background_job: "Starting a background job",
  list_bookings: "Checking bookings",
  create_booking: "Making a booking",
  update_booking_status: "Updating a booking",
  check_availability: "Checking availability",
  list_meetings: "Checking the calendar",
  schedule_meeting: "Scheduling a meeting",
  update_meeting: "Updating a meeting",
  cancel_meeting: "Cancelling a meeting",
  list_forms: "Checking forms",
  create_form: "Building a form",
  set_form_status: "Publishing a form",
  share_form_to_channel: "Sharing a form",
  get_form_response_summaries: "Reading form responses",
  read_resource: "Reading an attached document",
  get_org_chart: "Checking the org chart",
  list_workflows: "Checking workflows",
  trigger_workflow: "Running a workflow",
  send_notification: "Sending a notification",
  post_to_channel: "Posting to another channel",
  guest_conversation_insights: "Reviewing guest conversations",
  get_insight_brief: "Reading the insights brief",
  get_weekly_report: "Reading the weekly report",
  list_handovers: "Checking handovers",
  ask_question: "Working out what to ask",
  load_skill: "Loading a skill",
};

/**
 * Append one step to the turn's activity feed (migration 0096) AND set it as
 * the current label. The feed is what the chat shows as a timestamped list
 * while the turn runs and keeps as an expandable disclosure afterwards; the
 * label is the single-line "right now" state the indicator already reads.
 *
 * INSERT, never read-modify-write: handlers run as durable workflow steps and
 * parallel tool batches would race an array append.
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

/** The turn's steps, oldest first, for stamping onto the delivered message. */
export async function turnActivitySteps(
  row: DeliveryRow,
): Promise<Array<{ label: string; at: string }>> {
  if (!row.turn_nonce) return [];
  const { data } = await serviceClient()
    .from("channel_bot_activity")
    .select("label, created_at")
    .eq("channel_id", row.channel_id)
    .eq("thread_key", row.thread_key)
    .eq("turn_nonce", row.turn_nonce)
    .order("created_at", { ascending: true })
    .limit(40);
  return (data ?? []).map((r) => ({ label: r.label, at: r.created_at }));
}

/**
 * One progress label for a batch of tool calls. Repeats of the same tool
 * collapse with a count ("Reading 5 documents"), a mixed batch reports the
 * first — the point is a moving sign of life, not an audit trail.
 */
export function activityLabel(toolNames: string[]): string | null {
  const names = toolNames.filter(Boolean);
  if (names.length === 0) return null;
  const first = names[0];
  const base =
    TOOL_ACTIVITY[first] ?? first.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const sameTool = names.every((n) => n === first);
  if (sameTool && names.length > 1) return `${base} ×${names.length}…`;
  return `${base}…`;
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
  const hint = isApproval
    ? "_Reply with a number or the option name to decide. Nothing happens until you do._"
    : request.allowFreeform
      ? "_Reply with a number, or answer in your own words._"
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

  const rawText = (row.reply_candidate ?? "").trim();
  const replyText =
    rawText && row.kind === "job" && row.job_headline
      ? `✅ **${row.job_headline}** — finished:\n\n${rawText}`
      : rawText;

  // render_ui spec was validated + link-rewritten by the tool runtime-side;
  // revalidate defensively before attaching (same discipline the web glue
  // applied).
  let attachments: Array<{ type: string; spec: unknown }> | undefined;
  if (row.ui_spec) {
    const validated = validateChatUiSpec(row.ui_spec);
    if (validated.ok) attachments = [{ type: "ai_ui", spec: validated.spec }];
  }

  // A turn that parks on a question produces NO message text — the question
  // lives in the park payload. Append it below whatever text the turn did
  // produce: the prod failure had the model post a "I have a few quick
  // questions!" preamble and then lose the questions themselves.
  const questions = pendingQuestions(row).map(renderQuestion);
  const text = [replyText, ...questions].filter(Boolean).join("\n\n");

  // Activity feed (0096) travels WITH the reply as a custom field, so the
  // record of what the bot did outlives the transient thinking row and can be
  // opened later. Progressive disclosure: the client renders it collapsed.
  const steps = await turnActivitySteps(row);

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
 * the session.waiting handler WITH the fresh continuation token that event
 * carries: if messages queued up during the turn, start the next turn with
 * them immediately (coalesced); otherwise mark the turn slot idle.
 */
export async function drainQueueOrIdle(
  row: DeliveryRow,
  eveSessionId: string,
  continuationToken: string | null,
): Promise<void> {
  if (row.kind === "job") {
    // Jobs are one-shot: delivered → done. No queue, no follow-up turns.
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

  if (pending.length === 0 || !continuationToken) {
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

  // Resume with the fresh token; one retry covers the park-settle race.
  let sent = false;
  for (let attempt = 0; attempt < 2 && !sent; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(
      `${eveSelfOrigin()}/eve/v1/session/${encodeURIComponent(eveSessionId)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ continuationToken, message: turnMessage }),
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
