"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Channel, EventTypes } from "stream-chat";
import { useChannelPreviewInfo, useChatContext } from "stream-chat-react";
import { Hash, Lock } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { channelHref } from "@/lib/chat/channel-href";
import { useOpenChannel } from "@/lib/chat/use-open-channel";

type Props = {
  channel: Channel;
  propertyId: string;
  channelKind: "team" | "messaging";
};

/**
 * One conversation in the Chat node's sidebar body — a gr8r `.sitem` row
 * (`#` / lock glyph for team channels, the other person's `Av` for DMs),
 * bold ink + a `.ct.dotc` accent count while unread.
 */
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
  // channel list remounts whenever the sidebar node re-expands (and mounts
  // with `setActiveChannelOnMount={false}`), so Stream's context can render
  // out of sync with the route. The pathname is the source of truth.
  const isActive = pathname === channelPath;
  const isPrivate =
    (channel.data as { is_private?: boolean } | undefined)?.is_private ?? false;

  // For DMs, show the other user's name; for groups, comma-separated.
  const title =
    channelKind === "messaging"
      ? dmTitle(channel, client?.user?.id)
      : displayTitle ?? channel.id ?? "Untitled";
  const showUnread = unread > 0 && !isActive;

  return (
    <Link
      href={channelPath}
      onClick={handleClick}
      className={isActive ? "sitem on" : "sitem"}
      title={title}
      aria-current={isActive ? "page" : undefined}
      style={
        showUnread ? { color: "var(--g8-text)", fontWeight: 600 } : undefined
      }
    >
      {channelKind === "team" ? (
        <Gi icon={isPrivate ? Lock : Hash} size={15} />
      ) : (
        <DmAvatar channel={channel} currentUserId={client?.user?.id} />
      )}
      <span className="trunc">{title}</span>
      {showUnread ? (
        <span className="ct dotc">{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </Link>
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
  const other = Object.values(channel.state.members ?? {})
    .map((m) => m.user)
    .find((u) => u && u.id !== currentUserId);
  if (!other) return <Av member={null} size="sm" />;
  const av = (
    <Av
      member={{
        id: other.id,
        name: other.name ?? other.id,
        avatarUrl: (other.image as string | undefined) ?? null,
      }}
      size="sm"
    />
  );
  // gr8r `.presence` adds the green online dot to the avatar.
  return other.online ? <span className="presence" style={{ display: "inline-flex" }}>{av}</span> : av;
}
