"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Channel, EventTypes } from "stream-chat";
import { useChannelPreviewInfo, useChatContext } from "stream-chat-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Hash, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelHref } from "@/lib/chat/channel-href";
import { useOpenChannel } from "@/lib/chat/use-open-channel";

type Props = {
  channel: Channel;
  propertyId: string;
  channelKind: "team" | "messaging";
};

export function ChannelPreviewRow({
  channel,
  propertyId,
  channelKind,
}: Props) {
  const { client } = useChatContext();
  const { displayTitle } = useChannelPreviewInfo({ channel });
  const pathname = usePathname();
  const openChannel = useOpenChannel(propertyId);

  const [unread, setUnread] = useState(channel.countUnread());

  useEffect(() => {
    function bump() {
      setUnread(channel.countUnread());
    }
    const events: EventTypes[] = [
      "message.new",
      "message.read",
      "notification.mark_read",
      "notification.mark_unread",
      "channel.updated",
    ];
    const subs = events.map((e) => channel.on(e, bump));
    return () => subs.forEach((s) => s.unsubscribe());
  }, [channel]);

  // Team channels route under /chat, DMs under /dms — `channelKind` is the
  // Stream channel type, so it picks the right prefix.
  const channelPath = channelHref(propertyId, channelKind, channel.id ?? "");

  // Keep the real <a href> (middle-click / open-in-new-tab / a11y), but a
  // plain left-click switches client-side via pushState — no route nav, no
  // skeleton flash. Modified clicks fall through to the browser.
  function handleClick(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openChannel(channelKind, channel.id ?? "");
  }

  // Active state follows the URL, not Stream's `activeChannel` context. The
  // channel list remounts whenever the rail switches sections (and mounts
  // with `setActiveChannelOnMount={false}`), so Stream's context can render
  // out of sync with the route — the row would fail to highlight even though
  // its channel is open. The pathname is the source of truth, and matches how
  // every other secondary-sidebar item computes `isActive`.
  const isActive = pathname === channelPath;
  const isPrivate =
    (channel.data as { is_private?: boolean } | undefined)?.is_private ?? false;
  const Icon = channelKind === "team" ? (isPrivate ? Lock : Hash) : null;

  // For DMs, show the other user's name; for groups, comma-separated.
  const title =
    channelKind === "messaging"
      ? dmTitle(channel, client?.user?.id)
      : displayTitle ?? channel.id ?? "Untitled";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={channelPath} onClick={handleClick} />}
        isActive={isActive}
        tooltip={title}
        className={cn(
          unread > 0 && !isActive && "font-semibold text-foreground",
        )}
      >
        {Icon ? <Icon /> : <DmAvatar channel={channel} currentUserId={client?.user?.id} />}
        <span className="truncate">{title}</span>
        {unread > 0 && !isActive ? (
          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function dmTitle(channel: Channel, currentUserId: string | undefined) {
  const members = Object.values(channel.state.members ?? {});
  const others = members
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
  channel: Channel;
  currentUserId: string | undefined;
}) {
  const members = Object.values(channel.state.members ?? {});
  const other = members
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
    <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
      {initials || "?"}
    </span>
  );
}
