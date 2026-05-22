"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useChannelStateContext,
  useChatContext,
  useChannelPreviewInfo,
} from "stream-chat-react";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Hash,
  Lock,
  MoreVertical,
  Search,
  Star,
  Users,
} from "lucide-react";
import { useInfoPanel } from "../info-panel/context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { HuddleButton } from "@/components/chat/huddle/huddle-button";
import { MeetingButton } from "@/components/chat/meeting/meeting-button";

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
  const router = useRouter();
  const params = useParams<{ propertyId?: string }>();
  const propertyId = params?.propertyId;

  const isDm = channel.type === "messaging";
  const data = channel.data as
    | {
        is_private?: boolean;
        member_count?: number;
        description?: string;
      }
    | undefined;
  const isPrivate = data?.is_private ?? false;
  const memberCount =
    data?.member_count ??
    Object.keys(channel.state.members ?? {}).length;
  const description = data?.description?.trim() ?? "";

  const title = isDm
    ? dmTitle(channel, client?.user?.id)
    : displayTitle ?? channel.id ?? "Untitled";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          title="Star channel"
          aria-label="Star channel"
          className="bg-transparent text-muted-foreground hover:text-foreground dark:bg-transparent"
        >
          <Star className="size-[15px]" />
        </Button>
        <div className="flex min-w-0 items-center gap-1.5 pl-0.5">
          {isDm ? (
            <DmAvatar channel={channel} currentUserId={client?.user?.id} />
          ) : isPrivate ? (
            <Lock className="size-[18px] text-foreground" />
          ) : (
            <Hash className="size-[18px] text-foreground" strokeWidth={2.5} />
          )}
          <h1 className="truncate text-[18px] font-extrabold leading-none tracking-tight text-foreground">
            {title}
          </h1>
          <PresenceDots channel={channel} currentUserId={client?.user?.id} />
          {!isDm && description ? (
            <span
              className="ml-2 min-w-0 truncate text-[13px] text-muted-foreground"
              title={description}
            >
              {description}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isDm ? (
          <Button
            variant="outline"
            size="default"
            onClick={toggle}
            title="Members"
            className="gap-1.5 bg-transparent px-2.5 dark:bg-transparent"
          >
            <Users className="size-4 text-muted-foreground" />
            <span className="tabular-nums">{memberCount}</span>
          </Button>
        ) : null}
        {channel.id ? <HuddleButton channelId={channel.id} /> : null}
        {channel.id ? <MeetingButton channelId={channel.id} /> : null}
        <Button
          variant="outline"
          size="icon"
          title="Notifications"
          aria-label="Channel notifications"
          className="bg-transparent dark:bg-transparent"
        >
          <Bell />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Search in channel"
          aria-label="Search in channel"
          className="bg-transparent dark:bg-transparent"
          onClick={() => {
            if (!propertyId || !channel.id) return;
            router.push(
              `/p/${propertyId}/search?in=${encodeURIComponent(channel.id)}`,
            );
          }}
        >
          <Search />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="More"
          aria-label="More actions"
          onClick={toggle}
        >
          <MoreVertical />
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
    <Avatar className="size-6">
      <AvatarImage src={other?.image as string | undefined} />
      <AvatarFallback className="text-[10px]">{initials || "?"}</AvatarFallback>
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
    <span
      className="ml-1 inline-flex size-1.5 rounded-full bg-emerald-500"
      title={`${onlineCount} online`}
    />
  );
}
