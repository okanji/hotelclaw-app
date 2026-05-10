"use client";

import { useEffect, useState } from "react";
import {
  useChannelStateContext,
  useChatContext,
  useChannelPreviewInfo,
} from "stream-chat-react";
import { Button } from "@/components/ui/button";
import { Hash, Info, Lock, Users } from "lucide-react";
import { useInfoPanel } from "../info-panel/context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * Custom replacement for Stream's default <ChannelHeader>.
 * Renders inside <Window>, before <MessageList>. Slack-style:
 *   #channel-name · members · ●●● online dots · ℹ︎ info-toggle
 * For DMs, shows the other user's name (or comma-joined names for group DMs).
 */
export function ChannelHeader() {
  const { channel } = useChannelStateContext();
  const { client } = useChatContext();
  const { displayTitle } = useChannelPreviewInfo({ channel });
  const { toggle } = useInfoPanel();

  const isDm = channel.type === "messaging";
  const data = channel.data as
    | { is_private?: boolean; member_count?: number }
    | undefined;
  const isPrivate = data?.is_private ?? false;
  const memberCount =
    data?.member_count ??
    Object.keys(channel.state.members ?? {}).length;

  const title = isDm
    ? dmTitle(channel, client?.user?.id)
    : displayTitle ?? channel.id ?? "Untitled";

  return (
    <header className="flex items-center justify-between gap-3 border-b bg-background px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {isDm ? (
          <DmAvatar channel={channel} currentUserId={client?.user?.id} />
        ) : isPrivate ? (
          <Lock className="size-4 text-muted-foreground" />
        ) : (
          <Hash className="size-4 text-muted-foreground" />
        )}
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        {!isDm ? (
          <button
            onClick={toggle}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            title="Members"
          >
            <Users className="size-3" />
            {memberCount}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <PresenceDots channel={channel} currentUserId={client?.user?.id} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          title="Channel info"
        >
          <Info className="size-4" />
        </Button>
      </div>
    </header>
  );
}

function dmTitle(
  channel: ReturnType<typeof useChannelStateContext>["channel"],
  currentUserId: string | undefined,
) {
  const others = Object.values(channel.state.members ?? {})
    .map((m) => m.user)
    .filter((u): u is NonNullable<typeof u> => !!u && u.id !== currentUserId);
  if (others.length === 0) return "(empty conversation)";
  if (others.length === 1) return others[0].name ?? others[0].id;
  return others.map((u) => u.name ?? u.id).join(", ");
}

function DmAvatar({
  channel,
  currentUserId,
}: {
  channel: ReturnType<typeof useChannelStateContext>["channel"];
  currentUserId: string | undefined;
}) {
  const other = Object.values(channel.state.members ?? {})
    .map((m) => m.user)
    .find((u) => u && u.id !== currentUserId);
  const initials = (other?.name ?? other?.id ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Avatar className="size-5">
      <AvatarImage src={other?.image as string | undefined} />
      <AvatarFallback className="text-[9px]">{initials || "?"}</AvatarFallback>
    </Avatar>
  );
}

function PresenceDots({
  channel,
  currentUserId,
}: {
  channel: ReturnType<typeof useChannelStateContext>["channel"];
  currentUserId: string | undefined;
}) {
  const [, force] = useState(0);
  // re-render on presence changes
  useEffect(() => {
    const sub = channel.on("user.presence.changed", () => force((n) => n + 1));
    return () => sub.unsubscribe();
  }, [channel]);

  const onlineCount = Object.values(channel.state.members ?? {})
    .map((m) => m.user)
    .filter((u) => u && u.id !== currentUserId && u.online).length;

  if (onlineCount === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      {onlineCount} online
    </span>
  );
}
