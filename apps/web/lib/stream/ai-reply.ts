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
import { type ModelMessage } from "ai";
import { BOT_DISPLAY_NAME } from "@/lib/ai/bot-identity";
import { buildPropertyTools } from "@/lib/ai/tools";
import { buildRenderUiTool, type RenderUiSink } from "@/lib/ai/tools/render-ui";
import {
  DEFAULT_RESPONSE_GUIDELINES,
  runBot,
  type ActivationReason as RuntimeActivationReason,
} from "@/lib/ai/run-bot";
import { resolveChannelDeployment } from "@/lib/chatbots/channel-deployment";
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

/**
 * Re-export ActivationReason from the bot runtime so existing imports
 * from this file continue to compile (the webhook + tests rely on this).
 * The runtime owns the canonical type.
 */
export type ActivationReason = RuntimeActivationReason;

/**
 * Channel-bot persona — the only thing about prompt assembly that's
 * specific to this surface. Everything else (activation note, response
 * guidelines, deferral guard) lives in `runBot()` so all in-app bots
 * stay consistent. See AGENTS.md "Two-tier AI architecture".
 */
const CHANNEL_BOT_PERSONA = `You are ${BOT_DISPLAY_NAME}, an in-channel teammate inside a Slack-style chat for a hotel operations app.`;

/**
 * Channel-specific addition to the shared guidelines: structured answers
 * go through the `render_ui` tool (rich attachment), never markdown
 * tables — Stream's message renderer has no table styling and the model
 * kept emitting them for task lists.
 */
const CHANNEL_RESPONSE_GUIDELINES = [
  DEFAULT_RESPONSE_GUIDELINES,
  "When your answer is a set of records — task lists, schedules, workloads, comparisons, metrics — call the render_ui tool to display it as rich UI and keep your text to a one-line lead-in. Never write markdown tables in a chat reply.",
  "In render_ui, attach a link ref ({kind, id} from the tool results) to every row or card that corresponds to a real task, project, document, meeting, form, or team — users should be able to click straight through.",
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
    // Custom-chatbot deployment for this channel? When present, the reply
    // uses that bot's persona and gains its knowledge-base + custom-action
    // tools on top of the standard property tools. Null (the overwhelmingly
    // common case) leaves the default channel bot byte-for-byte unchanged.
    const deployment = await resolveChannelDeployment(ctx.streamChannelId);

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

    // Collects the spec from any render_ui call during generation. Reset at
    // the top of every coalesce attempt so a discarded generation's UI can't
    // leak onto the reply that actually posts.
    const uiSink: RenderUiSink = { spec: null };

    // ─── Coalesce loop ────────────────────────────────────────────────────
    // Generate, then re-query the channel/thread. If new non-bot messages
    // arrived during generation, the reply we just made doesn't address
    // them — throw it away and re-generate with the updated history. Up to
    // MAX_COALESCE_ATTEMPTS iterations. Most replies finish in 1 iteration;
    // bursts of 2-3 messages within ~5s typically settle in 2.
    for (let attempt = 1; attempt <= MAX_COALESCE_ATTEMPTS; attempt++) {
      const queryStartedAt = Date.now();
      uiSink.spec = null;
      try {
        const history = parentId
          ? await loadThreadHistory(channel, parentId, botUserId)
          : await loadChannelHistory(channel, botUserId);
        appendTriggerIfMissing(history, ctx.triggerMessage);

        const messages: ModelMessage[] = [
          ...(ctx.priorTurns ?? []),
          ...history.map((h) => ({
            role: h.role,
            content: h.content,
          }) as ModelMessage),
        ];

        // Delegate generation to the shared bot runtime. This is the only
        // call to the model — runBot wires in the channel persona, the
        // shared gbrain + delegate tools, the system prompt assembly, and
        // the standard model settings (Sonnet 4.6, temperature 0,
        // stopWhen: stepCountIs(5)). Surface-specific concerns (lock,
        // coalesce, typing indicators, Stream sendMessage) stay here.
        const result = await runBot({
          persona: deployment?.persona ?? CHANNEL_BOT_PERSONA,
          activationReason: ctx.activationReason ?? "mention",
          scopedTools: {
            ...buildPropertyTools(ctx.propertyId),
            ...(deployment ? deployment.tools : {}),
            ...buildRenderUiTool(ctx.propertyId, uiSink),
          },
          messages,
          scope: {
            propertyId: ctx.propertyId,
            userId: ctx.triggerMessage.userId,
            surface: "channel",
          },
          responseGuidelines: CHANNEL_RESPONSE_GUIDELINES,
          modelId: process.env.STREAM_BOT_MODEL, // legacy override
        });
        finalText = result.text;
        finalModelMessages = result.modelMessages;
        // Failed generations post an apology — never pair it with UI the
        // model built before the failure.
        if (!result.ok) uiSink.spec = null;
      } catch (err) {
        console.error("[ai-reply] runBot failed", err);
        finalText =
          "I hit an error generating that reply — try again in a moment.";
        uiSink.spec = null;
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
        ...(uiSink.spec
          ? { attachments: [{ type: "ai_ui", spec: uiSink.spec }] }
          : {}),
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
