"use client";

import { ChannelList, useChatContext } from "stream-chat-react";
import type { ChannelFilters, ChannelOptions, ChannelSort } from "stream-chat";
import { SidebarMenu } from "@/components/ui/sidebar";
import { ChannelPreviewRow } from "./channel-preview-row";

type Props = {
  propertyId: string;
  userId: string;
  channelKind: "team" | "messaging";
  emptyState?: React.ReactNode;
};

const SORT: ChannelSort = { last_message_at: -1, updated_at: -1 };
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

  // ChannelList depends on the StreamChat client being connected. The Chat
  // provider only mounts <Chat> after `connectUser()` resolves (see
  // lib/stream/client-provider.tsx), so we render a placeholder until then.
  if (!client) {
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">
        Connecting…
      </div>
    );
  }

  // ChannelFilters is strictly typed for built-in fields; Stream supports
  // arbitrary custom fields at runtime (we store property_id on every channel),
  // so cast through unknown to satisfy the type system.
  const filters = {
    type: channelKind,
    property_id: propertyId,
    members: { $in: [userId] },
  } as unknown as ChannelFilters;

  return (
    <ChannelList
      filters={filters}
      sort={SORT}
      options={OPTIONS}
      setActiveChannelOnMount={false}
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
  );
}
