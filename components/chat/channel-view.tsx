"use client";

import { useEffect, useState } from "react";
import {
  Channel,
  ChatView,
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
    // Strict-mode double-mount: the first effect's watch() can resolve after
    // the cleanup runs disconnectUser(), which makes channel.watch() reject
    // with "channel after disconnect()". Swallow it — the second mount will
    // re-watch with a fresh client.
    watch().catch((e) => {
      if (cancelled) return;
      console.error("channel.watch failed", e);
    });
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

  // <ChatView> wrapper: Stream's default <ThreadHeader> calls
  // useChatViewContext() and warns when no provider is found. Wrapping here
  // silences the warning without changing layout — ChatView just adds a
  // `display:flex; width:100%; height:100%` div around the Channel.
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ChatView>
        <Channel channel={channel}>
          <Window>
            {/* Group consecutive rows from the same user (`noGroupByUser` unset).
                Stream marks cluster segments as top / middle / bottom; globals.css + SlackMessageUI
                flip avatar/metadata visibility so only the first row matches Slack (like Slack desktop).
                Note: rows with attachments are always `single` — upstream getGroupStyles() behavior.

                showAvatar is set but Stream's `<Message>` does not forward it; SlackMessageUI defaults to true. */}
            <ChannelHeader />
            <MessageList showAvatar disableDateSeparator={false} />
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
      </ChatView>
    </div>
  );
}
