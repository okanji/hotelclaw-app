"use client";

import { useEffect, useState } from "react";
import { useChannelStateContext } from "stream-chat-react";
import type { MessageResponse } from "stream-chat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function PinnedTab() {
  const { channel } = useChannelStateContext();
  const [pinned, setPinned] = useState<MessageResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    channel
      .getPinnedMessages({ limit: 50 })
      .then((res) => {
        if (!cancelled) setPinned(res.messages ?? []);
      })
      .catch((e) => console.error("getPinnedMessages failed", e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // re-run when a message gets pinned/unpinned
  }, [channel, channel.state.pinnedMessages.length]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  if (pinned.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No pinned messages yet. Pin one from the message actions menu.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {pinned.map((msg) => {
        const name = msg.user?.name ?? msg.user?.id ?? "Someone";
        const initials = name
          .split(/\s+/)
          .map((p) => p[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        const when = msg.created_at
          ? new Date(msg.created_at).toLocaleString()
          : "";
        return (
          <li key={msg.id} className="rounded-md bg-muted p-2">
            <div className="flex items-start gap-2">
              <Avatar className="size-6">
                <AvatarImage src={msg.user?.image as string | undefined} />
                <AvatarFallback className="text-xs">
                  {initials || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{name}</span>
                  <span className="text-xs text-muted-foreground">
                    {when}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-3 break-words text-sm">
                  {msg.text || (msg.attachments?.length ? "(attachment)" : "")}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
