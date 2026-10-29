"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FavoriteStar } from "@/components/gr8r/favorite-star";
import {
  useChannelStateContext,
  useChatContext,
  useChannelPreviewInfo,
} from "stream-chat-react";
import {
  Hash,
  Info,
  Lock,
  MoreHorizontal,
  Search,
  Star,
  Users,
} from "lucide-react";
import { useInfoPanel } from "../info-panel/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { PageHeader } from "@/components/shell/page-header";
import { HuddleButton } from "@/components/chat/huddle/huddle-button";
import { MeetingButton } from "@/components/chat/meeting/meeting-button";
import { AiButton } from "./ai-button";
import { AutomationsButton } from "@/components/workflows/automations-button";

/**
 * Custom replacement for Stream's default <ChannelHeader>, rendered as the
 * page's gr8r topbar (`PageHeader` → `.topbar` › `.crumbs`): "Chat / #name"
 * with the presence dot and the channel topic as quiet meta, then the
 * channel's own actions — AI + Automations (the app doing work for you),
 * a divider, members, huddle, meeting, in-channel search, info — before the
 * shared topbar cluster (search / bell / New).
 * For DMs, shows the other user's `Av` + name (comma-joined for group DMs).
 *
 * Narrow widths (≤900px, `g8-ch-*` in gr8r-ext.css): the "Chat /" crumb, the
 * star and the divider drop out, AI / huddle / meeting collapse to their
 * icons, and members + in-channel search + details fold into one "…" menu,
 * so the topbar never overflows.
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

  function searchInChannel() {
    if (!propertyId || !channel.id) return;
    router.push(`/p/${propertyId}/search?in=${encodeURIComponent(channel.id)}`);
  }

  const start = (
    <>
      <span className="crumb g8-ch-wide">{isDm ? "Direct messages" : "Chat"}</span>
      <span aria-hidden="true" className="sep g8-ch-wide">
        /
      </span>
      <h1 className="crumb cur">
        {isDm ? (
          <DmAvatar channel={channel} currentUserId={client?.user?.id} />
        ) : (
          <Gi icon={isPrivate ? Lock : Hash} size={14} />
        )}
        <span className="trunc">{title}</span>
        <PresenceDot channel={channel} currentUserId={client?.user?.id} />
      </h1>
      <button
        type="button"
        className="ibtn ibtn-xs g8-ch-wide"
        title="Star channel"
        aria-label="Star channel"
      >
        <Gi icon={Star} size={13} />
      </button>
    </>
  );

  return (
    <PageHeader
      start={start}
      meta={
        !isDm && description ? (
          <span title={description}>{description}</span>
        ) : undefined
      }
      actions={
        <div className="row g8-chacts" style={{ gap: 2 }}>
          {/* AI sits on its own, left of the channel utilities, set off by a
              divider — it's a different class of control (the assistant)
              from members/call/search. */}
          {channel.id ? (
            <span className="g8-ch-lbl">
              <AiButton />
            </span>
          ) : null}
          {/* Automations join AI on the assistant side of the divider. */}
          {channel.id && propertyId ? (
            <AutomationsButton
              propertyId={propertyId}
              feature="chat"
              showLabel={false}
              className="h-7 px-2"
            />
          ) : null}
          {channel.id ? (
            <span
              aria-hidden
              className="g8-ch-wide"
              style={{
                width: 1,
                height: 18,
                margin: "0 4px",
                background: "var(--g8-border)",
              }}
            />
          ) : null}
          {!isDm ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm g8-ch-wide"
              onClick={toggle}
              title="Members"
            >
              <Gi icon={Users} size={14} />
              <span className="num">{memberCount}</span>
            </button>
          ) : null}
          {channel.id ? (
            <span className="g8-ch-lbl">
              <HuddleButton channelId={channel.id} />
            </span>
          ) : null}
          {channel.id ? (
            <span className="g8-ch-lbl">
              <MeetingButton channelId={channel.id} />
            </span>
          ) : null}
          {channel.id && propertyId ? (
            <FavoriteStar
              propertyId={propertyId}
              kind="channel"
              id={channel.id}
              className="ibtn ibtn-sm g8-ch-wide"
            />
          ) : null}
          <button
            type="button"
            className="ibtn ibtn-sm g8-ch-wide"
            title="Search in channel"
            aria-label="Search in channel"
            onClick={searchInChannel}
          >
            <Gi icon={Search} size={15} />
          </button>
          <button
            type="button"
            className="ibtn ibtn-sm g8-ch-wide"
            title="Channel details"
            aria-label="Channel details"
            onClick={toggle}
          >
            <Gi icon={MoreHorizontal} size={15} />
          </button>
          {/* ≤900px: the secondary utilities live behind one "…". */}
          <span className="g8-ch-narrow">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="ibtn ibtn-sm"
                    title="More"
                    aria-label="More channel actions"
                  />
                }
              >
                <Gi icon={MoreHorizontal} size={15} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6}>
                {!isDm ? (
                  <DropdownMenuItem onClick={toggle}>
                    <Users className="size-3.5" />
                    <span className="flex-1">Members</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {memberCount}
                    </span>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={searchInChannel}>
                  <Search className="size-3.5" />
                  <span className="flex-1">Search in channel</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggle}>
                  <Info className="size-3.5" />
                  <span className="flex-1">Channel details</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
      }
    />
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
  return (
    <Av
      member={
        other
          ? {
              id: other.id,
              name: other.name ?? other.id,
              avatarUrl: (other.image as string | undefined) ?? null,
            }
          : null
      }
      size="sm"
    />
  );
}

function PresenceDot({
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
      title={`${onlineCount} online`}
      aria-label={`${onlineCount} online`}
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--g8-green)",
        flexShrink: 0,
      }}
    />
  );
}
