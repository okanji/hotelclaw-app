"use client";

import { useEffect, useState } from "react";
import {
  Channel,
  MessageComposer,
  MessageList,
  Thread,
  Window,
  useChatContext,
} from "stream-chat-react";
import type { Channel as StreamChannel } from "stream-chat";
import { ChannelHeader } from "./channel-header";
import { ChannelInfoPanel } from "./info-panel/info-panel";

type Props = {
  channelId: string;
  channelType: string;
  channelName: string | null;
  propertyId: string;
};

export function ChannelView({
  channelId,
  channelType,
  channelName,
  propertyId,
}: Props) {
  const { client } = useChatContext();
  const [channel, setChannel] = useState<StreamChannel | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let watchedChannel: StreamChannel | null = null;
    async function watch() {
      const c = client!.channel(channelType, channelId);
      await c.watch();
      if (cancelled) return;
      watchedChannel = c;
      setChannel(c);
    }
    watch();
    return () => {
      cancelled = true;
      watchedChannel?.stopWatching().catch(() => {});
    };
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
        Loading{channelName ? ` #${channelName}` : ""}…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Channel channel={channel}>
        <Window>
          <ChannelHeader />
          <MessageList />
          {/* audioRecordingEnabled adds the voice-message mic to the composer
              (peer dep @breezystack/lamejs handles the MP3 encode client-side).
              Polls render in the "+" menu automatically via Stream's default
              AttachmentSelector — provided the channel type has polls enabled
              in the Stream dashboard (Channel Type → Settings → Polls). */}
          <MessageComposer audioRecordingEnabled />
        </Window>
        <Thread />
        <ChannelInfoPanel propertyId={propertyId} />
      </Channel>
    </div>
  );
}
