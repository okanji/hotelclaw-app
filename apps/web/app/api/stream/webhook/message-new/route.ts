import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { getStreamServer } from "@/lib/stream/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createNotifications,
  findAlreadyNotifiedUserIds,
} from "@/lib/notifications/server";
import {
  disengageThread,
  engageThread,
  getBotUserId,
  markSpinoffSkipped,
  readEngagementState,
  ROOT_THREAD_KEY,
  type ChannelEngagementState,
} from "@/lib/stream/ai-adapter";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import {
  shouldBotChimeIn,
  type ChimeSensitivity,
} from "@/lib/stream/ai-auto-classifier";
import { shouldStayEngaged } from "@/lib/stream/ai-engagement-classifier";
import {
  loadChannelHistory,
  loadThreadHistory,
} from "@/lib/stream/ai-history";
import {
  generateAndPostReply,
  postSignOff,
  type ActivationReason,
} from "@/lib/stream/ai-reply";
import { clearThread } from "@/lib/stream/ai-turn-history";
import { maybePodBotReply } from "@/lib/stream/pod-bot-reply";

/**
 * Stream Chat webhook → in-app notification fan-out.
 *
 * Why this exists alongside the client-side `chat-event-notifier`:
 *   • The client listener (`message.new` + `notification.message_new`) only
 *     fires for users whose tab is open and connected to Stream.
 *   • This webhook fires for every message regardless of any client state, so
 *     mentions persist as `notifications` rows even when the recipient is
 *     fully offline (no tab open, no app running).
 *
 * Both paths target the same `notifications` table and dedupe by `messageId`
 * within a 24-hour window, so whichever fires first wins and the other is a
 * no-op. Stream signs every webhook with HMAC-SHA256 in the `x-signature`
 * header — we verify it via `stream.verifyWebhook(rawBody, signature)`.
 *
 * Scope:
 *   • Only `message.new` events. Other event types are acknowledged with 200
 *     so Stream doesn't retry.
 *   • Only team channels (mirrored in `chat_channels`). DM mentions still
 *     flow through the client-side bridge — DM recipients who are entirely
 *     offline rely on Stream's unread counts when they reconnect.
 *
 * Configuration: in the Stream dashboard, set the webhook URL to
 *   `<APP_ORIGIN>/api/stream/webhook/message-new`
 * and subscribe to event type `message.new`. Equivalently, programmatically:
 *   `client.updateAppSettings({ webhook_url, webhook_events: ['message.new'] })`
 */

type WebhookMember = {
  user_id?: string;
  user?: { id?: string };
};

type WebhookMessage = {
  id: string;
  text?: string;
  user?: { id?: string; name?: string | null };
  mentioned_users?: Array<{ id: string }>;
  /** Set when the message is a thread reply; parent message id. */
  parent_id?: string;
  /** True if a thread reply also appears in the main channel timeline. */
  show_in_channel?: boolean;
};

type WebhookBody = {
  type: string;
  channel_type?: string;
  channel_id?: string;
  cid?: string;
  message?: WebhookMessage;
  members?: WebhookMember[];
};

const BROADCAST_RX = /(?:^|\s)@channel\b/;

// Vercel function ceiling. Stream's webhook timeout is short (we return in
// ~50ms via `after()`), but the `after()` callback itself — channel.query +
// Haiku classifier + Sonnet generation + Stream sendMessage — needs the
// function instance alive long enough to finish. Default is 10s on the Hobby
// tier; we lift to 60s (Hobby max) so multi-step tool flows have headroom.
// Per node_modules/ai/docs/06-advanced/10-vercel-deployment-guide.mdx.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const stream = getStreamServer();

  // Stream signs the raw request body. Must read as string BEFORE parsing —
  // `request.json()` would consume the stream and break signature verification.
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");
  if (!signature || !stream.verifyWebhook(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch (err) {
    console.error("[stream-webhook-message-new] JSON parse failed", err);
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.type !== "message.new") {
    // Acknowledge unrelated events so Stream stops retrying.
    return NextResponse.json({ ok: true, skipped: body.type });
  }

  // Defer ALL further work to after(). Stream's webhook timeout is short
  // enough that even a single Supabase round-trip in the synchronous path
  // (~600-1000ms) gets treated as a network failure, triggering retries
  // (each one spawning another AI generation → duplicate replies). With
  // everything deferred, the sync handler returns in <50ms.
  const webhookId = request.headers.get("x-webhook-id");
  const webhookAttempt = request.headers.get("x-webhook-attempt");
  after(async () => {
    try {
      await processMessageNew(body, webhookId, webhookAttempt);
    } catch (err) {
      console.error("[stream-webhook-message-new] processing failed", err);
    }
  });

  return NextResponse.json({ ok: true });
}

/**
 * All the actual work — runs in `after()` so the webhook response goes back
 * to Stream in <50ms. Any latency here (Supabase queries, Stream API calls,
 * AI generation) is invisible to Stream's retry logic.
 */
async function processMessageNew(
  body: WebhookBody,
  webhookId: string | null,
  webhookAttempt: string | null,
): Promise<void> {
  const msg = body.message;
  const channelId = body.channel_id ?? body.cid?.split(":")[1];
  const channelType = body.channel_type ?? body.cid?.split(":")[0];
  if (!msg || !channelId) return;
  if (channelType !== "team") return;

  const senderId = msg.user?.id;
  const text = msg.text ?? "";
  const directMentionIds = (msg.mentioned_users ?? [])
    .map((u) => u.id)
    .filter((id): id is string => !!id && id !== senderId);
  const broadcastMentioned = BROADCAST_RX.test(text);
  const botUserId = getBotUserId();
  const botMentioned = directMentionIds.includes(botUserId);
  const senderIsBot = senderId === botUserId;
  const isAiGenerated = (msg as { ai_generated?: boolean }).ai_generated ===
    true;

  // Light log only on retries — duplicates from the original Stream-timeout
  // bug are solved, but if a regression ever brings retries back this will
  // surface immediately without flooding the log on normal traffic.
  if (webhookAttempt && webhookAttempt !== "1") {
    console.warn("[stream-webhook-message-new] retry", {
      webhookId,
      webhookAttempt,
      msgId: msg.id,
    });
  }

  const service = createServiceClient();
  const { data: channelRow } = await service
    .from("chat_channels")
    .select("property_id, name, archived_at")
    .eq("stream_channel_id", channelId)
    .maybeSingle();

  if (!channelRow || channelRow.archived_at) return;

  // Workflow event: chat.message_posted (always) + chat.mention (per direct
  // mention). Wrapped so a workflow_events insert failure can't break chat.
  if (!senderIsBot && !isAiGenerated) {
    after(async () => {
      try {
        await emitWorkflowEvent({
          propertyId: channelRow.property_id,
          source: "stream.message",
          eventType: "chat.message_posted",
          entityId: msg.id,
          entityKind: "message",
          payload: {
            message: {
              id: msg.id,
              text,
              parent_id: msg.parent_id ?? null,
              user_id: senderId,
              user_name: msg.user?.name ?? null,
            },
            channel: {
              id: channelId,
              type: channelType,
              name: channelRow.name,
            },
          },
        });
        for (const uid of directMentionIds) {
          await emitWorkflowEvent({
            propertyId: channelRow.property_id,
            source: "stream.message",
            eventType: "chat.mention",
            entityId: msg.id,
            entityKind: "message",
            payload: {
              message: { id: msg.id, text, user_id: senderId },
              mentioned_user_id: uid,
              channel: { id: channelId, type: channelType, name: channelRow.name },
            },
          });
        }
      } catch (err) {
        console.error("[stream-webhook-message-new] emitWorkflowEvent failed", err);
      }
    });
  }

  // Pod-bot dispatch (fleet spec M3): a message addressed "@<bot_id> …" in
  // a pod property's channel goes to the durable eve runtime instead of the
  // legacy channel bot. Handled == this message's AI response is owned by
  // the pod bot; notifications/workflow events above still ran.
  if (!senderIsBot && !isAiGenerated && senderId) {
    const handledByPodBot = await maybePodBotReply({
      propertyId: channelRow.property_id,
      channelId,
      messageId: msg.id,
      senderId,
      senderName: msg.user?.name ?? null,
      text,
    });
    if (handledByPodBot) return;
  }

  // AI reply trigger. maybeTriggerAiReply schedules its own after() so the
  // synchronous handler still returns quickly (and processMessageNew can
  // continue with notifications without waiting on AI generation).
  if (!senderIsBot && !isAiGenerated) {
    maybeTriggerAiReply({
      channelId,
      channelType: channelType as "team",
      propertyId: channelRow.property_id,
      botUserId,
      botMentioned,
      // parent_id is set when the message is a thread reply. Treat the
      // channel top-level as a synthetic thread keyed "_root" so engagement
      // state, history loading, and reply targeting share one machinery.
      parentId: msg.parent_id ?? null,
      triggerMessage: {
        id: msg.id,
        text,
        userId: senderId ?? "unknown",
        userName: msg.user?.name ?? null,
      },
    });
  }

  if (directMentionIds.length === 0 && !broadcastMentioned) return;

  // Build the recipient set. Drop the bot — it doesn't need notifications
  // about being mentioned (and its id isn't a UUID, so notifications.user_id
  // would reject the insert with "invalid input syntax for type uuid").
  const recipients = new Set<string>(
    directMentionIds.filter((id) => id !== botUserId),
  );
  if (broadcastMentioned) {
    for (const m of body.members ?? []) {
      const uid = m.user_id ?? m.user?.id;
      if (uid && uid !== senderId && uid !== botUserId) recipients.add(uid);
    }
  }

  if (recipients.size === 0) return;

  // Dedupe against the client-side path: if the recipient's browser already
  // posted to /api/me/notifications/from-chat-event for this messageId in the
  // last 24h, skip them here.
  const alreadyNotified = await findAlreadyNotifiedUserIds({
    userIds: [...recipients],
    type: "mention",
    match: { key: "messageId", value: msg.id },
  });

  const toInsert: Array<{
    userId: string;
    propertyId: string;
    type: "mention";
    payload: Record<string, unknown>;
  }> = [];
  for (const userId of recipients) {
    if (alreadyNotified.has(userId)) continue;
    toInsert.push({
      userId,
      propertyId: channelRow.property_id,
      type: "mention",
      payload: {
        channelId,
        // This handler early-returns for non-team channels, so the type and
        // name are always the team channel's.
        channelType: "team",
        channelName: channelRow.name,
        messageId: msg.id,
        byUserId: senderId ?? null,
        byUserName: msg.user?.name ?? null,
        preview: text.slice(0, 200),
      },
    });
  }

  if (toInsert.length === 0) return;

  await createNotifications(toInsert);
}

/**
 * Decide whether the AI bot should reply to this message, and if so, schedule
 * the generation to run after the webhook responds.
 *
 * Reply gating (per channel `ai_mode`):
 *   "mention"  — respond only when the bot is @-mentioned.
 *   "auto"     — respond on mention, OR when a Haiku classifier decides the
 *                bot would add value. `ai_sensitivity` tunes the classifier.
 *   "always"   — respond to every non-bot top-level message. Thread replies
 *                are NOT auto-answered (a noisy thread shouldn't drag the
 *                bot in for every reply); explicit mention is still honored.
 *   "engaged"  — respond on mention. The mentioned thread (or `_root` for
 *                top-level) enters "engaged" state; subsequent messages in
 *                that same thread are evaluated by a 3-way classifier
 *                (respond / stay_silent / disengage). When the bot is
 *                engaged somewhere AND a message arrives in a structurally
 *                linked thread/channel (a "spinoff"), a one-shot spinoff
 *                classifier decides whether to also engage there.
 *
 * Thread routing: when `parent_id` is set, history loads from the thread
 * (parent + replies) and the bot's reply lands in the thread via
 * `show_in_channel: false`. Without this, the bot's reply would pop into
 * the main channel even when mentioned inside a thread — broken UX.
 *
 * We use `after()` for the generation + classifier passes so the webhook
 * returns to Stream within its timeout window. Model latency stays off the
 * critical path.
 */
function maybeTriggerAiReply(args: {
  channelId: string;
  channelType: "team" | "messaging";
  propertyId: string;
  botUserId: string;
  botMentioned: boolean;
  /** null for top-level messages; the parent message id for thread replies. */
  parentId: string | null;
  triggerMessage: {
    id: string;
    text: string;
    userId: string;
    userName: string | null;
  };
}): boolean {
  // Everything happens in after() so the webhook returns immediately. Stream's
  // webhook timeout is short — the previous structure synchronously called
  // channel.query (a network round-trip) before scheduling generation, which
  // tipped a ~1s handler over the timeout and triggered Stream's retry loop
  // (we logged 5+ attempts of the same webhook id, each spawning a fresh
  // generateText call → multiple bot replies per user prompt). Now the
  // synchronous handler returns in <100ms and Stream sees a fast success.
  after(async () => {
    try {
      const stream = getStreamServer();
      const channel = stream.channel(args.channelType, args.channelId);
      let state;
      try {
        state = await channel.query({ members: { limit: 200 } });
      } catch (err) {
        console.error("[ai-trigger] channel.query failed", err);
        return;
      }
      const botIsMember = (state.members ?? []).some(
        (m) => m.user?.id === args.botUserId,
      );
      if (!botIsMember) return;

      const channelData = state.channel as unknown as
        | Record<string, unknown>
        | undefined;
      const mode = (channelData?.["ai_mode"] ?? "mention") as
        | "mention"
        | "auto"
        | "always"
        | "engaged";
      const sensitivity = ((channelData?.["ai_sensitivity"] as string) ??
        "balanced") as ChimeSensitivity;
      const engagementState = readEngagementState(channelData);
      const threadKey = args.parentId ?? ROOT_THREAD_KEY;

      // ─── Mode dispatch ───────────────────────────────────────────────────
      if (mode === "always" && args.parentId !== null && !args.botMentioned) {
        return;
      }
      if (mode === "mention" && !args.botMentioned) return;
      if (mode === "engaged") {
        const inScope =
          args.botMentioned ||
          engagementState.engaged.includes(threadKey) ||
          (engagementState.engaged.length > 0 &&
            !engagementState.skipped.includes(threadKey));
        if (!inScope) return;
      }

      try {
      // ─── Auto mode classifier gate ──────────────────────────────────────
      if (mode === "auto" && !args.botMentioned) {
        const history = args.parentId
          ? await loadThreadHistory(channel, args.parentId, args.botUserId)
          : await loadChannelHistory(channel, args.botUserId);
        const decision = await shouldBotChimeIn({
          history,
          triggerMessage: {
            text: args.triggerMessage.text,
            userId: args.triggerMessage.userId,
            userName: args.triggerMessage.userName,
          },
          sensitivity,
        });
        console.log("[ai-trigger:auto]", {
          channelId: args.channelId,
          threadKey,
          sensitivity,
          should_respond: decision.should_respond,
          reason: decision.reason,
        });
        if (!decision.should_respond) return;
        // Auto mode classifier said yes — pass that reason through so the
        // system prompt tells the model it's been intentionally invited
        // (otherwise the model sees no @-mention in history and defers).
        await generateAndPostReply(
          buildReplyContext(args, "auto-classifier"),
        );
        return;
      }

      // ─── Engaged mode ───────────────────────────────────────────────────
      if (mode === "engaged") {
        let engagement = engagementState;

        // Direct mention always engages this thread and responds.
        if (args.botMentioned) {
          engagement = await engageThread(
            args.channelId,
            args.channelType,
            engagement,
            threadKey,
          );
          await replyWithEngagedPersistence(args, threadKey, "mention");
          return;
        }

        const alreadyEngaged = engagement.engaged.includes(threadKey);

        if (alreadyEngaged) {
          // Engaged-mode follow-up: run the 3-way classifier.
          const history = args.parentId
            ? await loadThreadHistory(
                channel,
                args.parentId,
                args.botUserId,
              )
            : await loadChannelHistory(channel, args.botUserId);
          const decision = await shouldStayEngaged({
            history,
            triggerMessage: {
              text: args.triggerMessage.text,
              userId: args.triggerMessage.userId,
              userName: args.triggerMessage.userName,
            },
          });
          console.log("[ai-trigger:engaged]", {
            channelId: args.channelId,
            threadKey,
            decision: decision.decision,
            reason: decision.reason,
          });
          switch (decision.decision) {
            case "respond":
              await replyWithEngagedPersistence(
                args,
                threadKey,
                "engaged-follow-up",
              );
              return;
            case "stay_silent":
              return;
            case "disengage":
              // Order matters: do state cleanup BEFORE the user-facing
              // sign-off post. If the cleanup ran after, observers (the
              // test harness, future code that listens to message.new for
              // sign-offs, or a real user re-reading the channel) could
              // race the cleanup and see inconsistent state. Now: by the
              // time the user sees "Going quiet here", engagement +
              // tool-history are already wiped.
              await disengageThread(
                args.channelId,
                args.channelType,
                engagement,
                threadKey,
              );
              await clearThread(args.channelId, threadKey);
              await postSignOff(
                args.channelId,
                args.channelType,
                args.parentId,
              );
              return;
          }
        }

        // Spinoff candidate: engaged somewhere else, not here, not yet
        // skipped. Pull both contexts and let the spinoff classifier decide.
        // (See B.3.1 in the plan for the gating rule.)
        if (engagement.engaged.length > 0) {
          const localHistory = args.parentId
            ? await loadThreadHistory(
                channel,
                args.parentId,
                args.botUserId,
              )
            : await loadChannelHistory(channel, args.botUserId);
          const spinoffContext = await loadEngagedContext(
            channel,
            args.botUserId,
            engagement.engaged,
          );
          const decision = await shouldStayEngaged({
            history: localHistory,
            triggerMessage: {
              text: args.triggerMessage.text,
              userId: args.triggerMessage.userId,
              userName: args.triggerMessage.userName,
            },
            spinoffContext,
          });
          console.log("[ai-trigger:engaged:spinoff]", {
            channelId: args.channelId,
            threadKey,
            engagedKeys: engagement.engaged,
            decision: decision.decision,
            reason: decision.reason,
          });
          if (decision.decision === "respond") {
            engagement = await engageThread(
              args.channelId,
              args.channelType,
              engagement,
              threadKey,
            );
            // Spinoff is a NEW conversation in its own thread — don't inherit
            // tool history from the parent engagement. replyWithEngagedPersistence
            // will load whatever exists for this threadKey (empty here) and
            // start writing fresh.
            await replyWithEngagedPersistence(
              args,
              threadKey,
              "engaged-follow-up",
            );
          } else {
            // stay_silent / disengage both mean "don't engage here". Mark
            // skipped so we don't re-evaluate on every subsequent message
            // in this thread.
            await markSpinoffSkipped(
              args.channelId,
              args.channelType,
              engagement,
              threadKey,
            );
          }
          return;
        }

        // Engaged mode but nothing engaged + no mention = no-op
        return;
      }

      // ─── Mention or Always (no classifier gate) ─────────────────────────
      // botMentioned → direct mention; otherwise we got here via always-mode
      // (mention-mode would have returned early earlier in the function).
      await generateAndPostReply(
        buildReplyContext(args, args.botMentioned ? "mention" : "always-mode"),
      );
      } catch (err) {
        console.error("[ai-trigger] mode handler failed", err);
      }
    } catch (err) {
      console.error("[ai-trigger] reply pipeline failed", err);
    }
  });
  return true;
}

function buildReplyContext(
  args: {
    channelId: string;
    channelType: "team" | "messaging";
    propertyId: string;
    parentId: string | null;
    triggerMessage: {
      id: string;
      text: string;
      userId: string;
      userName: string | null;
    };
  },
  activationReason: ActivationReason = "mention",
) {
  return {
    streamChannelId: args.channelId,
    channelType: args.channelType,
    triggerMessage: args.triggerMessage,
    propertyId: args.propertyId,
    parentId: args.parentId,
    activationReason,
  };
}

/**
 * Engaged-mode reply wrapper. Loads prior tool-history turns from
 * `chat_ai_turns`, generates the reply with them prepended, then persists
 * this turn's `response.messages` so the next turn in the same engaged
 * thread can build on it.
 *
 * Used at three call sites in the engaged branch above: initial mention,
 * follow-up after classifier says "respond", and spinoff engagement. Each
 * call writes to the same (channelId, threadKey) row family; the
 * conversation is wiped when the classifier returns "disengage" via
 * `clearThread`.
 */
async function replyWithEngagedPersistence(
  args: Parameters<typeof buildReplyContext>[0] & {
    botUserId: string;
    botMentioned: boolean;
  },
  _threadKey: string,
  activationReason: ActivationReason,
): Promise<void> {
  // Engaged-mode continuity IS the durable eve session — the old Redis
  // turn-history (loadTurns/saveTurn) plumbing is gone with the legacy
  // stateless path.
  await generateAndPostReply(buildReplyContext(args, activationReason));
}

/**
 * Pull a flat sample of engaged-conversation history across all engaged
 * threads so the spinoff classifier has something to compare against.
 *
 * For each engaged threadKey we take the most recent few turns. `_root`
 * pulls from the channel top-level; everything else uses getReplies.
 */
async function loadEngagedContext(
  channel: ReturnType<typeof getStreamServer>["channel"] extends (
    ...args: never
  ) => infer C
    ? C
    : never,
  botUserId: string,
  engagedKeys: string[],
) {
  const slices = await Promise.all(
    engagedKeys.map(async (key) => {
      try {
        if (key === ROOT_THREAD_KEY) {
          return await loadChannelHistory(channel, botUserId, 6);
        }
        return await loadThreadHistory(channel, key, botUserId, 6);
      } catch (err) {
        console.error("[ai-trigger] loadEngagedContext slice failed", {
          key,
          err,
        });
        return [];
      }
    }),
  );
  return slices.flat();
}
