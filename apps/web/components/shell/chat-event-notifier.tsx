"use client";

import { useEffect } from "react";
import { useChatContext } from "stream-chat-react";
import type { Event } from "stream-chat";

/**
 * Bridges Stream's live chat events to our persistent notification center.
 *
 * Stream gives us real-time `notification.*` events but no persistent feed —
 * if the user is offline when an event fires, they miss it (the only
 * surviving signal is the cumulative unread count). For a unified
 * notification history that survives offline gaps, we POST relevant Stream
 * events to /api/me/notifications/from-chat-event, which verifies them
 * server-side and inserts a row.
 *
 * Stream's panel toasts (NotificationList, useNotificationApi) are NOT
 * forwarded — those are transient operational feedback ("message pinned"),
 * not the kind of thing that belongs in a long-lived notification feed.
 *
 * Multi-tab safe: the server dedupes by payload key (channel id, message id)
 * across a 24-hour window. If you have three tabs open and a mention fires,
 * only the first POST creates a row; the other two return `{ deduped: true }`.
 */
export function ChatEventNotifier({ propertyId }: { propertyId: string }) {
  const { client } = useChatContext();

  useEffect(() => {
    if (!client?.user?.id) return;
    const me = client.user.id;

    async function emit(body: object) {
      try {
        await fetch("/api/me/notifications/from-chat-event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        // Non-fatal — sidebar unread counts still work via Stream's events.
        console.warn("notifier POST failed", e);
      }
    }

    // notification.added_to_channel — fires when someone adds the current
    // user to a channel they weren't a member of.
    const onAdded = (event: Event) => {
      const channelId = event.channel?.id ?? event.channel_id;
      const byUserId = event.user?.id;
      if (!channelId) return;
      void emit({
        kind: "channel_added",
        propertyId,
        channelId,
        byUserId,
      });
    };

    // message.new — only fires while the channel is being watched, but we
    // sit inside the Chat provider so all watched channels broadcast here.
    // Forward when the current user is in mentioned_users OR when the text
    // contains a broadcast token (`@channel`) — the server then verifies
    // channel membership before persisting.
    const onMessage = (event: Event) => {
      const msg = event.message;
      const channelId = event.channel_id ?? event.cid?.split(":")[1];
      if (!msg || !channelId) return;
      // Skip own mentions (someone mentioning themselves).
      if (msg.user?.id === me) return;
      const directlyMentioned = (msg.mentioned_users ?? []).some(
        (u) => u.id === me,
      );
      const broadcastMentioned = /(?:^|\s)@channel\b/.test(msg.text ?? "");
      if (!directlyMentioned && !broadcastMentioned) return;
      void emit({
        kind: "mention",
        propertyId,
        channelId,
        messageId: msg.id,
        ...(directlyMentioned ? {} : { broadcast: true }),
      });
    };

    const subs = [
      client.on("notification.added_to_channel", onAdded),
      // `message.new` only fires for channels the user is currently watching.
      // `notification.message_new` fires for member channels the user is NOT
      // watching, so we cover both: messages in the open channel AND messages
      // arriving in other channels while the user is on a different page.
      // Same handler — both events carry `message` + `channel_id` in the same
      // shape, and the in-handler guard (mentioned / @channel only) prevents
      // notification spam for unmentioning messages.
      client.on("message.new", onMessage),
      client.on("notification.message_new", onMessage),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, [client, propertyId]);

  return null;
}
