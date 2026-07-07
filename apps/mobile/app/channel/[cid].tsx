import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
// SDK 56: import react-navigation APIs via expo-router, not @react-navigation/*
import { useHeaderHeight } from "expo-router/react-navigation";
import {
  Channel,
  MessageComposer,
  MessageList,
  useChatContext,
} from "stream-chat-expo";
import type { Channel as ChannelType } from "stream-chat";
import { useAppContext } from "../../contexts/AppContext";

export default function ChannelScreen() {
  const router = useRouter();
  const { cid } = useLocalSearchParams<{ cid: string }>();
  const { client } = useChatContext();
  const { channel: contextChannel, thread, setThread } = useAppContext();
  const [channel, setChannel] = useState<ChannelType | undefined>(
    contextChannel,
  );
  const headerHeight = useHeaderHeight();
  const headerHeightRef = useRef(headerHeight);

  // If we land here via a cold deep-link (no channel handed through context),
  // recreate the Channel instance from the cid param — per Stream's navigation
  // guidance, never pass Channel objects through navigation params.
  useEffect(() => {
    if (channel || !cid) return;
    // cid is "<type>:<id>" (e.g. "team:abc"); derive both so this works for
    // any channel type the app uses.
    const [channelType, channelId] = cid.includes(":")
      ? (cid.split(":") as [string, string])
      : (["team", cid] as [string, string]);
    const newChannel = client.channel(channelType, channelId);
    let active = true;
    newChannel.watch().then(() => {
      if (active) setChannel(newChannel);
    });
    return () => {
      active = false;
    };
  }, [cid, channel, client]);

  if (!channel) {
    return (
      <SafeAreaView>
        <Text>Loading chat ...</Text>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: channel.data?.name ?? "Channel" }} />
      <Channel
        channel={channel}
        keyboardVerticalOffset={headerHeightRef.current}
        topInset={headerHeightRef.current}
        thread={thread}
      >
        <MessageList
          onThreadSelect={(message) => {
            setThread(message);
            router.push({
              pathname: "/channel/[cid]/thread/[messageId]",
              params: { cid: channel.cid, messageId: message?.id ?? "" },
            });
          }}
        />
        <MessageComposer />
      </Channel>
    </>
  );
}
