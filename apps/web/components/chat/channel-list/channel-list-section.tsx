"use client";

import {
  ChannelList,
  ComponentProvider,
  getChannel,
  useChatContext,
  useComponentContext,
} from "stream-chat-react";
import type { ChannelFilters, ChannelOptions, ChannelSort } from "stream-chat";
import { SidebarMenu } from "@/components/ui/sidebar";
import { ChannelPreviewRow } from "./channel-preview-row";
import { SidebarRowsSkeleton } from "./sidebar-rows-skeleton";

type Props = {
  propertyId: string;
  userId: string;
  channelKind: "team" | "messaging";
  emptyState?: React.ReactNode;
};

// Stream warns when a sort object has multiple fields ("Object's field order
// is not guaranteed"). Pass an array of single-field sort objects so the
// priority is explicit.
const SORT: ChannelSort = [{ last_message_at: -1 }, { updated_at: -1 }];
const OPTIONS: ChannelOptions = {
  state: true,
  watch: true,
  presence: true,
  limit: 30,
};

export function ChannelListSection({
  propertyId,
  userId,
  channelKind,
  emptyState,
}: Props) {
  const { client } = useChatContext();

  // While the Chat client is connecting, show the same skeleton we'll show
  // once ChannelList takes over its own loading. Avoids a "Connecting…" text
  // flash before the shimmer.
  if (!client) {
    return <SidebarRowsSkeleton withAvatar={channelKind === "messaging"} />;
  }

  // ChannelFilters is strictly typed for built-in fields; Stream supports
  // arbitrary custom fields at runtime (we store property_id on every channel),
  // so cast through unknown to satisfy the type system.
  // `frozen: false` hides archived (soft-deleted) channels — deleteChannel
  // freezes the Stream channel and stamps archived_at on our row.
  const filters = {
    type: channelKind,
    property_id: propertyId,
    members: { $in: [userId] },
    frozen: false,
  } as unknown as ChannelFilters;

  // Stream's default LoadingIndicator for ChannelList is a stack of big
  // card-shaped shimmers (avatar + two text lines per row) that doesn't match
  // our compact sidebar rows. Override via ComponentProvider — the
  // v14-sanctioned way to swap context-supplied UI.
  const SkeletonForKind = () => (
    <SidebarRowsSkeleton withAvatar={channelKind === "messaging"} />
  );

  return (
    <ScopedComponents LoadingIndicator={SkeletonForKind}>
      <ChannelList
        filters={filters}
        sort={SORT}
        options={OPTIONS}
        setActiveChannelOnMount={false}
        // Stream defaults to true — when ANY new channel event fires
        // (notification.added_to_channel, message.new, etc.) it auto-pushes
        // that channel into the list, ignoring our `filters`. With two
        // ChannelList instances (team + messaging) this means a newly-created
        // DM briefly appears in the Channels list too. Disable, then enforce
        // the type filter ourselves below.
        allowNewMessagesFromUnfilteredChannels={false}
        // Setting the flag above to `false` ALSO disables Stream's built-in
        // `notification.added_to_channel` handler (it early-returns when the
        // flag is off), so a freshly created channel never enters the list
        // until a full refetch — i.e. a page refresh. Supply our own handler:
        // it re-checks the two filter dimensions the event payload exposes
        // (channel type + property) and prepends matching channels live.
        onAddedToChannel={async (setChannels, event) => {
          const ec = event.channel;
          if (!ec?.id || ec.type !== channelKind) return;
          if ((ec as { property_id?: string }).property_id !== propertyId) {
            return;
          }
          const channel = await getChannel({
            client,
            type: ec.type,
            id: ec.id,
            members: ec.members
              ?.map((m) => m.user_id ?? m.user?.id ?? "")
              .filter((id): id is string => id.length > 0),
          });
          setChannels((channels) =>
            channels.some((c) => c.cid === channel.cid)
              ? channels
              : [channel, ...channels],
          );
        }}
        // Render-time guard. Even if Stream's internal state ever surfaces a
        // mismatched channel here, this strips it before it hits the DOM.
        channelRenderFilterFn={(channels) =>
          channels.filter((c) => c.type === channelKind)
        }
        EmptyStateIndicator={() => (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {emptyState ?? "Nothing here yet."}
          </div>
        )}
        renderChannels={(channels) => (
          <SidebarMenu>
            {channels.map((c) => (
              <ChannelPreviewRow
                key={c.cid}
                channel={c}
                propertyId={propertyId}
                channelKind={channelKind}
              />
            ))}
          </SidebarMenu>
        )}
      />
    </ScopedComponents>
  );
}

/**
 * Merge the parent ComponentContext with our local override so we don't blow
 * away other components Stream needs (Avatar, Message, etc.). ComponentProvider
 * replaces `value` entirely; spreading the existing context preserves it.
 */
function ScopedComponents({
  LoadingIndicator,
  children,
}: {
  LoadingIndicator: React.ComponentType;
  children: React.ReactNode;
}) {
  const parent = useComponentContext();
  return (
    <ComponentProvider value={{ ...parent, LoadingIndicator }}>
      {children}
    </ComponentProvider>
  );
}
