import { NextResponse, type NextRequest } from "next/server";
import { getStreamServer } from "@/lib/stream/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createNotifications,
  findAlreadyNotifiedUserIds,
} from "@/lib/notifications/server";

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

export async function POST(request: NextRequest) {
  const stream = getStreamServer();

  // Stream signs the raw request body. We must read the body as a string
  // BEFORE parsing JSON — `request.json()` would consume the stream.
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");
  if (!signature || !stream.verifyWebhook(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.type !== "message.new") {
    // Acknowledge unrelated events so Stream stops retrying.
    return NextResponse.json({ ok: true, skipped: body.type });
  }

  const msg = body.message;
  const channelId = body.channel_id ?? body.cid?.split(":")[1];
  const channelType = body.channel_type ?? body.cid?.split(":")[0];
  if (!msg || !channelId) {
    return NextResponse.json({ ok: true, skipped: "missing-fields" });
  }
  // Only team channels are mirrored in `chat_channels`; DMs flow through
  // the client-side bridge. Skip silently.
  if (channelType !== "team") {
    return NextResponse.json({ ok: true, skipped: "non-team-channel" });
  }

  const senderId = msg.user?.id;
  const text = msg.text ?? "";
  const directMentionIds = (msg.mentioned_users ?? [])
    .map((u) => u.id)
    .filter((id): id is string => !!id && id !== senderId);
  const broadcastMentioned = BROADCAST_RX.test(text);

  if (directMentionIds.length === 0 && !broadcastMentioned) {
    return NextResponse.json({ ok: true, skipped: "no-mentions" });
  }

  // Resolve the channel to a property — `chat_channels.stream_channel_id` is
  // unique per property and the lookup is indexed.
  const service = createServiceClient();
  const { data: channelRow } = await service
    .from("chat_channels")
    .select("property_id, name, archived_at")
    .eq("stream_channel_id", channelId)
    .maybeSingle();

  if (!channelRow || channelRow.archived_at) {
    return NextResponse.json({ ok: true, skipped: "unknown-channel" });
  }

  // Build the recipient set.
  const recipients = new Set<string>(directMentionIds);
  if (broadcastMentioned) {
    for (const m of body.members ?? []) {
      const uid = m.user_id ?? m.user?.id;
      if (uid && uid !== senderId) recipients.add(uid);
    }
  }

  if (recipients.size === 0) {
    return NextResponse.json({ ok: true, skipped: "no-recipients" });
  }

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
        messageId: msg.id,
        byUserId: senderId ?? null,
        byUserName: msg.user?.name ?? null,
        preview: text.slice(0, 200),
      },
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, allDeduped: true });
  }

  await createNotifications(toInsert);
  return NextResponse.json({ ok: true, inserted: toInsert.length });
}
