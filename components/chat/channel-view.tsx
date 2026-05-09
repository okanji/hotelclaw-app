"use client";

import { useEffect, useState } from "react";
import {
  Channel,
  ChannelHeader,
  MessageComposer,
  MessageList,
  Thread,
  Window,
  useChatContext,
} from "stream-chat-react";
import type { Channel as StreamChannel } from "stream-chat";

type Props = {
  channelId: string;
  channelType: string;
  channelName: string;
};

export function ChannelView({ channelId, channelType, channelName }: Props) {
  const { client } = useChatContext();
  const [channel, setChannel] = useState<StreamChannel | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    async function watch() {
      const c = client.channel(channelType, channelId);
      await c.watch();
      if (!cancelled) setChannel(c);
    }
    watch();
    return () => {
      cancelled = true;
      channel?.stopWatching().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channelId, channelType]);

  if (!client) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Connecting to chat…
      </div>
    );
  }
  if (!channel) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading #{channelName}…
      </div>
    );
  }

  // Stream's recommended layout: parent must be a fixed-height flex container
  // so MessageList scrolls internally and MessageComposer stays pinned.
  return (
    <div className="flex h-full min-h-0 flex-1">
      <Channel channel={channel}>
        <Window>
          <ChannelHeader />
          <MessageList />
          <MessageComposer />
        </Window>
        <Thread />
      </Channel>
    </div>
  );
}
