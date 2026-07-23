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
};

const ROW_COLUMNS =
  "id, property_id, channel_id, channel_type, thread_key, turn_nonce, reply_candidate, ui_spec, delivered_nonce";

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
  const parentId = row.thread_key === ROOT_THREAD_KEY ? null : row.thread_key;
  const botId = botUserId();

  await channel
    .sendEvent({
      type: "typing.stop",
      user_id: botId,
      ...(parentId ? { parent_id: parentId } : {}),
    } as unknown as Parameters<typeof channel.sendEvent>[0])
    .catch(() => {});

  const text = (row.reply_candidate ?? "").trim();
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

  try {
    await channel.sendMessage({
      // Deterministic id: Stream upserts on id, so a handler replay cannot
      // double-post the same turn.
      id: row.turn_nonce ? `eve-${row.turn_nonce}` : undefined,
      text,
      user_id: botId,
      ai_generated: true,
      ...(attachments ? { attachments } : {}),
      ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
    } as unknown as Parameters<typeof channel.sendMessage>[0]);
  } catch (err) {
    console.error("[channel-delivery] sendMessage failed", err);
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
  const parentId = row.thread_key === ROOT_THREAD_KEY ? null : row.thread_key;
  await channel
    .sendMessage({
      text: `⚠️ AI reply failed — eve session error: ${reason.slice(0, 300)}. Check the runtime logs.`,
      user_id: botUserId(),
      ai_generated: true,
      ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
    } as unknown as Parameters<typeof channel.sendMessage>[0])
    .catch((e) => console.error("[channel-delivery] failure notice failed", e));
}

/**
 * Release the web-side generation lock (Upstash REST DEL — the lock module
 * lives in apps/web; the key shape `ai-gen-lock:<channel>:<thread>` is the
 * shared contract, TTL 60s is the fallback if this call never lands).
 */
export async function releaseGenerationLock(
  channelId: string,
  threadKey: string,
): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/del/${encodeURIComponent(`ai-gen-lock:${channelId}:${threadKey}`)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // TTL expiry covers it.
  }
}
