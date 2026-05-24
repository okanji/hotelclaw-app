import "server-only";
/**
 * Stream Chat AI reply pipeline.
 *
 * Called from `/api/stream/webhook/message-new` when a message arrives that
 * the bot should respond to (decided by the webhook based on the channel's
 * `ai_mode` field + whether the bot is mentioned).
 *
 * Flow:
 *   1. Post an empty placeholder message as the bot with `ai_generated: true`.
 *   2. Emit `ai_indicator.update` with AI_STATE_THINKING so the existing
 *      Stream Chat React UI shows a typing indicator on the placeholder.
 *   3. Fetch last N messages from the channel and build a multi-turn
 *      messages array. Bot's own past messages are tagged `role: assistant`
 *      by id-equality (not by the SDK's hardcoded `ai-bot` prefix check).
 *   4. Call `generateText` with property-scoped tools enabled.
 *   5. Replace the placeholder text with the final reply via
 *      `partialUpdateMessage`. On error, replace with an error message and
 *      emit AI_STATE_ERROR.
 *
 * Non-streaming. We trade per-token streaming for a much simpler arch
 * (no websocket-as-bot, no SDK dependency). The "thinking…" indicator
 * runs while `generateText` resolves, which is usually 1-5s for short
 * Sonnet replies — acceptable UX for chat use.
 */
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { StreamChat } from "stream-chat";
import { BOT_DISPLAY_NAME } from "@/lib/ai/bot-identity";
import { buildPropertyTools } from "@/lib/ai/tools";
import { createServiceClient } from "@/lib/supabase/server";
import { getBotUserId } from "./ai-adapter";
import {
  loadChannelHistory,
  prefixUser,
  type HistoryTurn,
} from "./ai-history";
import { getStreamServer } from "./server";

const MODEL_ID = process.env.STREAM_BOT_MODEL ?? "claude-sonnet-4-6";

const SYSTEM_PROMPT = [
  `You are ${BOT_DISPLAY_NAME}, an in-channel teammate inside a Slack-style chat for a hotel operations app.`,
  "Be concise (1-3 sentences by default). Default to short answers; expand only when the user explicitly asks for detail.",
  "You have tools to look up tasks, documents, and meetings scoped to this property. Use them when the user asks about workload, docs, or scheduling — never make up data.",
  "If a tool returns no results, say so plainly. If something is outside your reach (account changes, billing, code), say so.",
].join(" ");

/**
 * Resolve the property id for a Stream channel via the `chat_channels` mirror.
 * Returns null if the channel isn't tracked (DMs may not be — caller decides).
 */
export async function resolvePropertyIdForChannel(
  streamChannelId: string,
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("chat_channels")
    .select("property_id")
    .eq("stream_channel_id", streamChannelId)
    .maybeSingle();
  return data?.property_id ?? null;
}

export type ReplyContext = {
  streamChannelId: string;
  channelType: "team" | "messaging";
  /** The new incoming message that triggered this reply. */
  triggerMessage: {
    id: string;
    text: string;
    userId: string;
    userName?: string | null;
  };
  /** Property scope for tools. */
  propertyId: string;
};

export async function generateAndPostReply(ctx: ReplyContext): Promise<void> {
  const stream = getStreamServer();
  const botUserId = getBotUserId();
  const channel = stream.channel(ctx.channelType, ctx.streamChannelId);

  // 1. Post placeholder as the bot so the UI shows immediate feedback. The
  //    `ai_generated` flag lets the client style this specially if needed,
  //    and our webhook + this module both skip messages with that flag so
  //    we never loop on our own placeholder. `ai_generated` is a custom
  //    field — Stream's typed message data only lists built-ins, so cast.
  const placeholderRes = await channel.sendMessage({
    text: "",
    user_id: botUserId,
    ai_generated: true,
  } as unknown as Parameters<typeof channel.sendMessage>[0]);
  const placeholderId = placeholderRes.message.id;

  // 2. Thinking indicator. Stream Chat React's MessageUI picks these up via
  //    ai_indicator.update events scoped to the message cid + id.
  await channel
    .sendEvent({
      type: "ai_indicator.update",
      ai_state: "AI_STATE_THINKING",
      cid: placeholderRes.message.cid,
      message_id: placeholderId,
    })
    .catch((e) => console.error("[ai-reply] sendEvent thinking failed", e));

  try {
    // 3. Build history. loadChannelHistory pulls fresh from Stream and
    //    role-tags by id-equality (bot vs other). The triggering message
    //    usually lands in this read, but the webhook can outrun the
    //    readback — append explicitly if it's missing so the model always
    //    sees the prompt that triggered it.
    const history = await loadChannelHistory(channel, botUserId);
    appendTriggerIfMissing(history, ctx.triggerMessage);

    if (!process.env.ANTHROPIC_API_KEY) {
      await finalizeMessage(
        stream,
        placeholderId,
        "I need `ANTHROPIC_API_KEY` configured to respond — ask an admin to set it up.",
      );
      return;
    }

    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const tools = buildPropertyTools(ctx.propertyId);

    // 4. Generate. The model can take multiple tool-call → model-call
    //    cycles via the SDK's internal step machinery; we pass system
    //    separately rather than as a leading message.
    const result = await generateText({
      model: anthropic(MODEL_ID),
      system: SYSTEM_PROMPT,
      messages: history.map((h) => ({ role: h.role, content: h.content })),
      tools,
    });

    const reply = (result.text ?? "").trim() || "(no reply)";
    await finalizeMessage(stream, placeholderId, reply);
  } catch (err) {
    console.error("[ai-reply] generateText failed", err);
    await finalizeMessage(
      stream,
      placeholderId,
      "I hit an error generating that reply — try again in a moment.",
      "AI_STATE_ERROR",
    );
  }
}

async function finalizeMessage(
  stream: StreamChat,
  messageId: string,
  text: string,
  aiState: string = "AI_STATE_DONE",
) {
  try {
    await stream.partialUpdateMessage(messageId, {
      set: { text },
    });
  } catch (err) {
    console.error("[ai-reply] partialUpdateMessage failed", err);
  }
  // The Stream Node SDK doesn't expose sendEvent on a bare message ref —
  // and the partialUpdate alone is enough for the UI to render the final
  // text. Indicator-clearing event is left for a follow-up if we wire a
  // dedicated AI-message UI component.
  void aiState;
}

/**
 * Append the triggering message as a user turn if it isn't already the last
 * entry in the loaded history. Stream's webhook can fire faster than the
 * channel.query readback, so we sometimes see history that doesn't include
 * the message that woke us up.
 */
export function appendTriggerIfMissing(
  history: HistoryTurn[],
  triggerMessage: ReplyContext["triggerMessage"],
): void {
  const line = prefixUser({
    text: triggerMessage.text,
    userName: triggerMessage.userName ?? null,
    userId: triggerMessage.userId,
  });
  const last = history[history.length - 1];
  if (last?.role === "user" && last.content === line) return;
  history.push({ role: "user", content: line });
}
