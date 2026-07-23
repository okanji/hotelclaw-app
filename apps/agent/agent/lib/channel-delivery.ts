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
};

const ROW_COLUMNS =
  "id, property_id, channel_id, channel_type, thread_key, turn_nonce, reply_candidate, ui_spec, delivered_nonce, kind, job_headline";

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

  await channel
    .sendEvent({
      type: "typing.stop",
      user_id: botId,
      ...(parentId ? { parent_id: parentId } : {}),
    } as unknown as Parameters<typeof channel.sendEvent>[0])
    .catch(() => {});

  const rawText = (row.reply_candidate ?? "").trim();
  const text =
    rawText && row.kind === "job" && row.job_headline
      ? `✅ **${row.job_headline}** — finished:\n\n${rawText}`
      : rawText;
  if (!text) {
    // Fail-loud contract: an empty turn is a bug, never silence.
    await channel
      .sendMessage({
        id: row.turn_nonce ? `eve-${row.turn_nonce}` : undefined,
        text: "⚠️ AI reply failed — the agent turn completed without producing a reply. Check the runtime logs.",
        user_id: botId,
        ai_generated: true,
        ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
      } as unknown as Parameters<typeof channel.sendMessage>[0])
      .catch((e) => console.error("[channel-delivery] empty-turn notice failed", e));
    return;
  }

  // render_ui spec was validated + link-rewritten by the tool runtime-side;
  // revalidate defensively before attaching (same discipline the web glue
  // applied).
  let attachments: Array<{ type: string; spec: unknown }> | undefined;
  if (row.ui_spec) {
    const validated = validateChatUiSpec(row.ui_spec);
    if (validated.ok) attachments = [{ type: "ai_ui", spec: validated.spec }];
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
