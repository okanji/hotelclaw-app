import "server-only";
/**
 * Stream Chat AI reply pipeline.
 *
 * Called from `/api/stream/webhook/message-new` when a message arrives that
 * the bot should respond to.
 *
 * Flow:
 *   1. Emit `typing.start` so Stream Chat React shows the native typing
 *      indicator. No placeholder message — avoids the empty-bubble UX and
 *      removes a self-triggering surface (the placeholder was firing
 *      `message.new` itself).
 *   2. Fetch last N messages (thread or channel scope depending on parentId)
 *      and build a multi-turn messages array. Bot's own past messages are
 *      tagged `role: assistant` by id-equality.
 *   3. Call `generateText` with property-scoped tools enabled.
 *   4. Emit `typing.stop` and post the final message in one shot.
 *
 * Non-streaming. We trade per-token streaming for a much simpler arch:
 * one final message, native typing indicator, no partial updates.
 */
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { BOT_DISPLAY_NAME } from "@/lib/ai/bot-identity";
import { buildPropertyTools } from "@/lib/ai/tools";
import { createServiceClient } from "@/lib/supabase/server";
import { getBotUserId } from "./ai-adapter";
import {
  loadChannelHistory,
  loadThreadHistory,
  prefixUser,
  type HistoryTurn,
} from "./ai-history";
import { getStreamServer } from "./server";

const MODEL_ID = process.env.STREAM_BOT_MODEL ?? "claude-sonnet-4-6";

// System prompt design notes:
//   • Don't enumerate tools — the SDK auto-injects tool schemas and the model
//     reads them. Listing tool names here is redundant token spend.
//   • Focus on persona, length, and the *behavior* around tool use ("call them,
//     don't fabricate"). Tool selection logic lives in the tool descriptions
//     themselves (see lib/ai/tools.ts).
//   • Short prompts (<1024 tok for Sonnet) can't use Anthropic prompt caching,
//     so token efficiency matters more than length.
const SYSTEM_PROMPT = [
  `You are ${BOT_DISPLAY_NAME}, an in-channel teammate inside a Slack-style chat for a hotel operations app.`,
  "Be concise: 1-3 sentences by default. Expand only when the user explicitly asks for detail.",
  "When the user asks about specific property data (tasks, docs, meetings), use the available tools rather than guessing. If a tool returns 0 results, say so plainly — never fabricate.",
  "If something is outside your reach (account changes, billing, code, general advice), say so briefly and move on.",
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
  /**
   * Set when the trigger message is a thread reply. The bot replies inside
   * the same thread, and history is loaded from the thread (parent + replies)
   * instead of the channel top-level.
   *
   * null/undefined → top-level reply, channel-level history.
   */
  parentId?: string | null;
  /**
   * Prior model turns (with tool calls + results) from earlier in an engaged
   * conversation. Prepended to the messages array so the bot can build on
   * its earlier tool work without re-querying. Loaded from the Supabase
   * `chat_ai_turns` table by the webhook handler in engaged mode.
   *
   * Unset for mention/auto/always modes — each turn is conceptually
   * independent there.
   */
  priorTurns?: ModelMessage[];
  /**
   * Called after a successful generation with the full `response.messages`
   * so the caller can persist this turn for replay on subsequent calls.
   * Webhook handler wires this to `saveTurn(...)` in engaged mode only.
   * Errors thrown here are swallowed (logged) so they don't fail the reply.
   */
  onTurnComplete?: (modelMessages: ModelMessage[]) => Promise<void>;
};

/** Constant used by the engaged-mode webhook branch when the bot disengages. */
export const SIGN_OFF_TEXT =
  "Going quiet here — mention me to bring me back.";

export async function generateAndPostReply(ctx: ReplyContext): Promise<void> {
  const stream = getStreamServer();
  const botUserId = getBotUserId();
  const channel = stream.channel(ctx.channelType, ctx.streamChannelId);
  const parentId = ctx.parentId ?? null;

  // 1. Native typing indicator. Stream Chat React renders "Hotelclaw is
  //    typing…" out of the box for typing.start events. No empty bubble in
  //    the timeline (vs. the old placeholder pattern, which left a blank
  //    message visible while we were generating).
  //
  //    Server-side events require user_id — Stream rejects unidentified
  //    events with "either event.user or event.user_id must be provided".
  await channel
    .sendEvent({
      type: "typing.start",
      user_id: botUserId,
      ...(parentId ? { parent_id: parentId } : {}),
    } as unknown as Parameters<typeof channel.sendEvent>[0])
    .catch((e) => console.error("[ai-reply] typing.start failed", e));

  let finalText = "";
  try {
    // 2. Build history. For thread replies, pull the thread (parent +
    //    replies) so the bot's context is the actual conversation it was
    //    mentioned in — not the unrelated top-level channel timeline.
    const history = parentId
      ? await loadThreadHistory(channel, parentId, botUserId)
      : await loadChannelHistory(channel, botUserId);
    appendTriggerIfMissing(history, ctx.triggerMessage);

    if (!process.env.ANTHROPIC_API_KEY) {
      finalText =
        "I need `ANTHROPIC_API_KEY` configured to respond — ask an admin to set it up.";
    } else {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      const tools = buildPropertyTools(ctx.propertyId);
      // stopWhen: default is stepCountIs(1) — that's "stop after the first
      // step that has tool results", which means the model can call a tool
      // but never synthesize a final reply with what it got back. We need
      // at least 2 steps (tool call + synthesis); 5 leaves headroom for
      // chained tool calls without unbounded loops.
      // temperature: 0 per AI SDK docs (20-prompt-engineering.mdx:89) —
      // tool-call argument generation is much more reliable at 0.
      //
      // History composition:
      //   • priorTurns (set in engaged mode only): the model's own past
      //     turns for THIS conversation, including tool-call + tool-result
      //     parts. Loaded from chat_ai_turns by the webhook.
      //   • text history: every visible user/bot text turn in the
      //     thread/channel, prefixed with speaker names.
      // Prepending priorTurns first reconstructs the conversation as the
      // model saw it growing across turns. For mention/auto/always (no
      // priorTurns), this reduces to plain text history.
      const messages: ModelMessage[] = [
        ...(ctx.priorTurns ?? []),
        ...history.map((h) => ({
          role: h.role,
          content: h.content,
        }) as ModelMessage),
      ];
      const result = await generateText({
        model: anthropic(MODEL_ID),
        system: SYSTEM_PROMPT,
        messages,
        tools,
        temperature: 0,
        stopWhen: stepCountIs(5),
      });
      finalText = (result.text ?? "").trim() || "(no reply)";

      // Hand the full transcript back to the caller for persistence. Only
      // engaged mode wires this up; in other modes the call is a no-op.
      // Failures swallowed: persistence shouldn't break user-visible replies.
      if (ctx.onTurnComplete && result.response?.messages) {
        try {
          await ctx.onTurnComplete(result.response.messages);
        } catch (err) {
          console.error("[ai-reply] onTurnComplete failed", err);
        }
      }
    }
  } catch (err) {
    console.error("[ai-reply] generateText failed", err);
    finalText = "I hit an error generating that reply — try again in a moment.";
  }

  // 3. Stop typing + post the final message in one shot. No placeholder, no
  //    partial update — the message appears with its text already populated.
  await channel
    .sendEvent({
      type: "typing.stop",
      user_id: botUserId,
      ...(parentId ? { parent_id: parentId } : {}),
    } as unknown as Parameters<typeof channel.sendEvent>[0])
    .catch((e) => console.error("[ai-reply] typing.stop failed", e));

  try {
    await channel.sendMessage({
      text: finalText,
      user_id: botUserId,
      ai_generated: true,
      ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
    } as unknown as Parameters<typeof channel.sendMessage>[0]);
  } catch (err) {
    console.error("[ai-reply] sendMessage final failed", err);
  }
}

/**
 * Post the engaged-mode disengagement sign-off into the thread (or top-level
 * channel if `parentId` is null). The sign-off is just a regular bot message
 * marked `ai_generated` so it can't trigger another bot response.
 *
 * Called from the webhook engaged branch when the engagement classifier
 * returns `disengage`. Failing to post the sign-off shouldn't crash the
 * engagement state update — log and move on.
 */
export async function postSignOff(
  streamChannelId: string,
  channelType: "team" | "messaging",
  parentId: string | null,
): Promise<void> {
  const stream = getStreamServer();
  const botUserId = getBotUserId();
  const channel = stream.channel(channelType, streamChannelId);
  try {
    await channel.sendMessage({
      text: SIGN_OFF_TEXT,
      user_id: botUserId,
      ai_generated: true,
      ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
    } as unknown as Parameters<typeof channel.sendMessage>[0]);
  } catch (err) {
    console.error("[ai-reply] sign-off failed", {
      streamChannelId,
      parentId,
      err,
    });
  }
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
