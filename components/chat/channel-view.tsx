"use client";

import { useEffect, useState } from "react";
import {
  Channel,
  ChatView,
  MessageList,
  Thread,
  Window,
  useChatContext,
} from "stream-chat-react";
import type { Channel as StreamChannel } from "stream-chat";
import { ChannelHeader } from "./channel-header";
import { ChannelTabs } from "./channel-tabs";
import { ChannelInfoPanel } from "./info-panel/info-panel";
import { SlackComposer } from "./slack-composer";
import { MessageJumper } from "./search/message-jumper";
import { slackRenderText } from "./slack-render-text";

type Props = {
  channelId: string;
  channelType: string;
  channelName: string | null;
  propertyId: string;
  messageId?: string | null;
};

export function ChannelView({
  channelId,
  channelType,
  channelName,
  propertyId,
  messageId = null,
}: Props) {
  const { client } = useChatContext();
  const [channel, setChannel] = useState<StreamChannel | null>(null);

  useEffect(() => {
    if (!client) {
      setChannel(null);
      return;
    }
    let cancelled = false;
    let watchedChannel: StreamChannel | null = null;
    async function watch() {
      const c = client.channel(channelType, channelId);
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
      // Drop stale channel immediately when client/channel key changes so we never
      // render <Channel> with an instance tied to a disconnected client.
      setChannel(null);
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
            <ChannelTabs />
            <MessageList
              showAvatar
              disableDateSeparator={false}
              renderText={slackRenderText}
            />
            <SlackComposer />
          </Window>
          <Thread
            additionalMessageListProps={{ renderText: slackRenderText }}
          />
          <ChannelInfoPanel propertyId={propertyId} />
          <MessageJumper messageId={messageId} />
        </Channel>
      </ChatView>
    </div>
  );
}
