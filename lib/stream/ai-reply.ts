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
import { getBotUserId, ROOT_THREAD_KEY } from "./ai-adapter";
import {
  releaseGenerationLock,
  tryAcquireGenerationLock,
} from "./ai-generation-lock";
import {
  loadChannelHistory,
  loadThreadHistory,
  prefixUser,
  type HistoryTurn,
} from "./ai-history";
import { getStreamServer } from "./server";

const MODEL_ID = process.env.STREAM_BOT_MODEL ?? "claude-sonnet-4-6";

/**
 * Activation reason — why the webhook decided to invoke the model for this
 * message. Passed through to the system prompt so the model understands
 * its role and doesn't mimic deferral patterns from prior in-context turns
 * (a real failure mode: when the channel has past bot replies that say
 * "tag me to bring me back", the model continues the pattern even with a
 * strong system prompt because in-context examples can outweigh static
 * instructions).
 */
export type ActivationReason =
  | "mention"
  | "auto-classifier"
  | "always-mode"
  | "engaged-follow-up";

// System prompt design notes:
//   • Don't enumerate tools — the SDK auto-injects tool schemas.
//   • Express the activation reason inline so the model knows WHY it's
//     being asked to respond. This breaks pattern-matching from
//     conversation history (see ActivationReason).
//   • Reserve "outside my reach" for genuinely out-of-scope topics
//     (billing, code, account admin) — NOT broad operational questions.
//   • Short prompts (<1024 tok for Sonnet) can't use Anthropic prompt
//     caching, so token efficiency matters more than length.
function activationNote(reason: ActivationReason): string {
  switch (reason) {
    case "mention":
      return "The user just @-mentioned you. They want your direct attention — respond.";
    case "auto-classifier":
      return "A classifier just judged that this message would benefit from your input even though you weren't @-mentioned. Don't second-guess that decision and don't ask to be tagged — you're already in the conversation.";
    case "always-mode":
      return "This channel is in 'always respond' mode: the team wants you to respond to every message in this channel, even ones not addressed to you. Respond as a participating teammate. Do NOT say 'I wasn't tagged' or ask the user to mention you — you've been explicitly invited to participate in every message here.";
    case "engaged-follow-up":
      return "You're currently engaged in this conversation. Respond as a continuing participant — the user is following up on something you were just discussing. Don't ask to be re-tagged; you're already in the conversation.";
  }
}

function systemPromptFor(reason: ActivationReason): string {
  return [
    `You are ${BOT_DISPLAY_NAME}, an in-channel teammate inside a Slack-style chat for a hotel operations app.`,
    "",
    `# Why you're responding now`,
    activationNote(reason),
    "",
    "# How to respond",
    "Be concise: 1-3 sentences by default. Expand only when the user explicitly asks for detail.",
    "When the question is about specific property data (tasks, docs, meetings), use the available tools rather than guessing. If a tool returns 0 results, say so plainly — never fabricate.",
    "When the question is broader (operations, planning, judgment calls), share your best take like a knowledgeable colleague.",
    "Only decline when something is genuinely outside your scope: account admin, billing, code changes, anything legally sensitive.",
    "",
    "# Ignore deferral patterns in history",
    "If you see prior assistant turns in the conversation history where you said things like 'I wasn't tagged' or 'mention me to bring me back', those were from a buggier version of you. Do not continue that pattern. Per the activation note above, you ARE being asked to respond now.",
  ].join("\n");
}

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
   * Why the webhook decided to invoke the model. Used to compose the
   * system prompt so the model knows its role (and doesn't mimic past
   * deferral patterns from history). Defaults to "mention" if unset.
   */
  activationReason?: ActivationReason;
  /**
   * Prior model turns (with tool calls + results) from earlier in an engaged
   * conversation. Prepended to the messages array so the bot can build on
   * its earlier tool work without re-querying. Loaded from Redis by the
   * webhook handler in engaged mode.
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

/**
 * Max coalesce-loop iterations. Bounds the cost when messages keep
 * arriving during generation. 3 covers realistic bursts (3-5 rapid
 * messages); beyond that the user is firing faster than we can think.
 */
const MAX_COALESCE_ATTEMPTS = 3;

export async function generateAndPostReply(ctx: ReplyContext): Promise<void> {
  const stream = getStreamServer();
  const botUserId = getBotUserId();
  const channel = stream.channel(ctx.channelType, ctx.streamChannelId);
  const parentId = ctx.parentId ?? null;
  const threadKey = parentId ?? ROOT_THREAD_KEY;

  // ─── Single-flight lock ─────────────────────────────────────────────────
  // Only one generation runs at a time per channel+thread. If we can't
  // acquire the lock, another generation is already in flight for this
  // conversation — drop silently; its coalesce loop will re-check for new
  // messages (ours included) before posting and address them. The user
  // gets one cohesive reply instead of N overlapping ones.
  const got = await tryAcquireGenerationLock(ctx.streamChannelId, threadKey);
  if (!got) {
    console.log("[ai-reply] gen lock held — dropping (in-flight gen will absorb)", {
      channelId: ctx.streamChannelId,
      threadKey,
      triggerMsgId: ctx.triggerMessage.id,
    });
    return;
  }

  try {
    // Native typing indicator (no placeholder message; renders inline).
    await channel
      .sendEvent({
        type: "typing.start",
        user_id: botUserId,
        ...(parentId ? { parent_id: parentId } : {}),
      } as unknown as Parameters<typeof channel.sendEvent>[0])
      .catch((e) => console.error("[ai-reply] typing.start failed", e));

    let finalText = "";
    let finalModelMessages: ModelMessage[] | undefined;

    // ─── Coalesce loop ────────────────────────────────────────────────────
    // Generate, then re-query the channel/thread. If new non-bot messages
    // arrived during generation, the reply we just made doesn't address
    // them — throw it away and re-generate with the updated history. Up to
    // MAX_COALESCE_ATTEMPTS iterations. Most replies finish in 1 iteration;
    // bursts of 2-3 messages within ~5s typically settle in 2.
    for (let attempt = 1; attempt <= MAX_COALESCE_ATTEMPTS; attempt++) {
      const queryStartedAt = Date.now();
      try {
        const history = parentId
          ? await loadThreadHistory(channel, parentId, botUserId)
          : await loadChannelHistory(channel, botUserId);
        appendTriggerIfMissing(history, ctx.triggerMessage);

        if (!process.env.ANTHROPIC_API_KEY) {
          finalText =
            "I need `ANTHROPIC_API_KEY` configured to respond — ask an admin to set it up.";
          break;
        }

        const anthropic = createAnthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        const tools = buildPropertyTools(ctx.propertyId);
        const messages: ModelMessage[] = [
          ...(ctx.priorTurns ?? []),
          ...history.map((h) => ({
            role: h.role,
            content: h.content,
          }) as ModelMessage),
        ];
        const result = await generateText({
          model: anthropic(MODEL_ID),
          system: systemPromptFor(ctx.activationReason ?? "mention"),
          messages,
          tools,
          temperature: 0,
          stopWhen: stepCountIs(5),
        });
        finalText = (result.text ?? "").trim() || "(no reply)";
        finalModelMessages = result.response?.messages;
      } catch (err) {
        console.error("[ai-reply] generateText failed", err);
        finalText =
          "I hit an error generating that reply — try again in a moment.";
        break;
      }

      // Should we re-run? Only if more attempts allowed AND a new non-bot
      // message arrived after we started this attempt's query.
      if (attempt < MAX_COALESCE_ATTEMPTS) {
        const hasNewer = await hasNewerNonBotMessage(
          channel,
          parentId,
          botUserId,
          queryStartedAt,
        );
        if (hasNewer) {
          console.log("[ai-reply] coalesce: new message arrived during gen, regenerating", {
            channelId: ctx.streamChannelId,
            threadKey,
            attempt,
          });
          continue;
        }
      }
      break;
    }

    // Persist only the FINAL attempt's transcript (engaged mode only —
    // mention/auto/always pass no onTurnComplete).
    if (ctx.onTurnComplete && finalModelMessages) {
      try {
        await ctx.onTurnComplete(finalModelMessages);
      } catch (err) {
        console.error("[ai-reply] onTurnComplete failed", err);
      }
    }

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
  } finally {
    await releaseGenerationLock(ctx.streamChannelId, threadKey);
  }
}

/**
 * Returns true if there's at least one non-bot message in the channel/thread
 * with `created_at > sinceMs`. Used by the coalesce loop to detect that
 * more messages arrived during the just-completed generation.
 */
async function hasNewerNonBotMessage(
  channel: ReturnType<typeof getStreamServer>["channel"] extends (
    ...args: never
  ) => infer C
    ? C
    : never,
  parentId: string | null,
  botUserId: string,
  sinceMs: number,
): Promise<boolean> {
  try {
    let messages;
    if (parentId) {
      const res = await channel.getReplies(parentId, { limit: 5 });
      messages = res.messages ?? [];
    } else {
      const state = await channel.query({ messages: { limit: 5 } });
      messages = state.messages ?? [];
    }
    for (const m of messages) {
      if (m.user?.id === botUserId) continue;
      if ((m.text ?? "").trim() === "") continue;
      if (!m.created_at) continue;
      if (new Date(m.created_at).getTime() > sinceMs) return true;
    }
    return false;
  } catch (err) {
    console.error("[ai-reply] hasNewerNonBotMessage failed", err);
    return false; // fail-safe: don't loop forever on read errors
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
