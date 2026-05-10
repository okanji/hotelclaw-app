"use client";

import { useEffect, useState } from "react";
import { useChannelStateContext, useChatContext } from "stream-chat-react";
import type { ChannelMemberResponse } from "stream-chat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function MembersTab({ propertyId: _propertyId }: { propertyId: string }) {
  const { channel } = useChannelStateContext();
  const { client } = useChatContext();
  const [members, setMembers] = useState<ChannelMemberResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    channel
      .queryMembers({})
      .then((res) => {
        if (!cancelled) setMembers(res.members ?? []);
      })
      .catch((e) => {
        console.error("queryMembers failed", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  // Force a re-render when presence changes so dots update.
  const [, force] = useState(0);
  useEffect(() => {
    const sub = channel.on("user.presence.changed", () => force((n) => n + 1));
    return () => sub.unsubscribe();
  }, [channel]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  if (members.length === 0) {
    return <p className="text-xs text-muted-foreground">No members yet.</p>;
  }

  return (
    <ul className="space-y-1">
      {members.map((m) => {
        const user = m.user;
        if (!user) return null;
        const isMe = user.id === client?.user?.id;
        const liveUser = client?.state.users[user.id];
        const online = liveUser?.online ?? false;
        const name = user.name ?? user.id;
        const initials = name
          .split(/\s+/)
          .map((p) => p[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <li
            key={user.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
          >
            <div className="relative">
              <Avatar className="size-7">
                <AvatarImage src={user.image as string | undefined} />
                <AvatarFallback className="text-[10px]">
                  {initials || "?"}
                </AvatarFallback>
              </Avatar>
              {online ? (
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500"
                  title="Online"
                />
              ) : null}
            </div>
            <div className="flex-1 truncate text-sm">
              {name}
              {isMe ? (
                <span className="ml-1 text-xs text-muted-foreground">(you)</span>
              ) : null}
            </div>
            {m.role && m.role !== "member" ? (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.role}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
