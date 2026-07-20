import "server-only";
/**
 * Stream Chat AI reply pipeline.
 *
 * Called from `/api/stream/webhook/message-new` when a message arrives that
 * the bot should respond to. Trigger classification stays webhook-side;
 * GENERATION is one durable eve session per (channel, thread) — the default
 * channel bot AND custom-chatbot channel deployments alike (the runtime
 * resolves chatbot_channel_deployments off the x-hotelclaw-channel header
 * and swaps persona/tools; see apps/agent agent/lib/agent-config.ts and
 * agent/tools/channel-deployment.ts).
 *
 * Eve is the ONLY engine here (2026-07-20): any eve failure posts a visible
 * ⚠️ error to the channel — never a silent stateless fallback. The old
 * runBot() coalesce loop is gone; sessions are not a message queue, so
 * messages landing mid-turn arrive as unseen context on the next trigger.
 *
 * Flow:
 *   1. Single-flight lock per (channel, thread).
 *   2. `typing.start` (native indicator, no placeholder message).
 *   3. Eve turn — resume the durable session or start one.
 *   4. `typing.stop` + post the reply (with any validated ai_ui attachment)
 *      in one shot. Non-streaming by design.
 */
import { type ActivationReason as RuntimeActivationReason } from "@/lib/ai/run-bot";
import { type RenderUiSink } from "@/lib/ai/tools/render-ui";
import { validateChatUiSpec } from "@hotelclaw/chat-ui";
import { createServiceClient } from "@/lib/supabase/server";
import { getBotUserId, ROOT_THREAD_KEY } from "./ai-adapter";
import {
  releaseGenerationLock,
  tryAcquireGenerationLock,
} from "./ai-generation-lock";
import { runChannelBotEveTurn } from "./channel-bot-eve";
import { getStreamServer } from "./server";

/**
 * Re-export ActivationReason from the bot runtime so existing imports
 * from this file continue to compile (the webhook + tests rely on this).
 * The runtime owns the canonical type.
 */
export type ActivationReason = RuntimeActivationReason;

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
   * the same thread, and the durable session is keyed to the thread.
   *
   * null/undefined → top-level reply, the channel-root session.
   */
  parentId?: string | null;
  /**
   * Why the webhook decided to invoke the model. Composed into the turn's
   * activation note so the model knows its role. Defaults to "mention".
   */
  activationReason?: ActivationReason;
};

/** Constant used by the engaged-mode webhook branch when the bot disengages. */
export const SIGN_OFF_TEXT =
  "Going quiet here — mention me to bring me back.";

export async function generateAndPostReply(ctx: ReplyContext): Promise<void> {
  const stream = getStreamServer();
  const botUserId = getBotUserId();
  const channel = stream.channel(ctx.channelType, ctx.streamChannelId);
  const parentId = ctx.parentId ?? null;
  const threadKey = parentId ?? ROOT_THREAD_KEY;

  // ─── Single-flight lock ─────────────────────────────────────────────────
  // Only one generation runs at a time per channel+thread. If we can't
  // acquire the lock, another turn is already in flight for this
  // conversation — drop silently; the message we'd have answered arrives
  // as unseen context on that session's next trigger.
  const got = await tryAcquireGenerationLock(ctx.streamChannelId, threadKey);
  if (!got) {
    console.log("[ai-reply] gen lock held — dropping (in-flight turn will absorb)", {
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

    const eveTurn = await runChannelBotEveTurn({
      propertyId: ctx.propertyId,
      streamChannelId: ctx.streamChannelId,
      channelType: ctx.channelType,
      parentId,
      triggerMessage: ctx.triggerMessage,
      activationReason: ctx.activationReason ?? "mention",
    });

    await channel
      .sendEvent({
        type: "typing.stop",
        user_id: botUserId,
        ...(parentId ? { parent_id: parentId } : {}),
      } as unknown as Parameters<typeof channel.sendEvent>[0])
      .catch((e) => console.error("[ai-reply] typing.stop failed", e));

    if (!eveTurn.ok) {
      console.error("[ai-reply] eve turn FAILED — no fallback", {
        channelId: ctx.streamChannelId,
        reason: eveTurn.reason,
      });
      // ai_generated so this can't re-trigger the bot.
      await channel
        .sendMessage({
          text: `⚠️ AI reply failed — eve runtime error: ${eveTurn.reason}. Check the server logs.`,
          user_id: botUserId,
          ai_generated: true,
          ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
        } as unknown as Parameters<typeof channel.sendMessage>[0])
        .catch((e) => console.error("[ai-reply] failure notice failed", e));
      return;
    }

    // render_ui spec collected from the session stream (already validated +
    // link-rewritten runtime-side against the same shared catalog) —
    // revalidate defensively before attaching.
    const uiSink: RenderUiSink = { spec: null };
    if (eveTurn.uiSpec) {
      const validated = validateChatUiSpec(eveTurn.uiSpec);
      if (validated.ok) uiSink.spec = validated.spec;
    }

    try {
      await channel.sendMessage({
        text: eveTurn.text,
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
