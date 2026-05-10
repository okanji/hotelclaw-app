"use client";

import { useEffect, useState } from "react";
import type { StreamChat } from "stream-chat";
import { useChatContext } from "stream-chat-react";

/**
 * Tracks `client.user.total_unread_count` reactively. Stream updates the
 * field on the user record when:
 *   - notification.message_new (new msg in a non-active channel)
 *   - notification.mark_read   (channel marked read)
 *   - message.read             (read state changed)
 * We re-read after each so the badge stays in sync without polling.
 */
export function useUnreadCount() {
  const { client } = useChatContext();
  const [count, setCount] = useState<number>(
    extractCount(client ?? undefined),
  );

  useEffect(() => {
    if (!client) return;
    const update = () => setCount(extractCount(client));
    update();
    const subs = (
      [
        "notification.message_new",
        "notification.mark_read",
        "notification.mark_unread",
        "message.read",
      ] as const
    ).map((e) => client.on(e, update));
    return () => subs.forEach((s) => s.unsubscribe());
  }, [client]);

  return count;
}

function extractCount(client: StreamChat | undefined): number {
  const u = client?.user;
  if (!u) return 0;
  const v = (u as { total_unread_count?: number }).total_unread_count;
  return typeof v === "number" ? v : 0;
}
