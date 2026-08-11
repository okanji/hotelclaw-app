import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
// SDK 56: import react-navigation APIs via expo-router, not @react-navigation/*
import { useHeaderHeight } from "expo-router/react-navigation";
import { Channel, Thread, useChatContext } from "stream-chat-expo";
import type { Channel as ChannelType } from "stream-chat";
import { useAppContext } from "../../../../contexts/AppContext";
import { CustomAttachmentProvider } from "../../../../components/attachments/CustomAttachments";
import {
  CLUSTER_TIME_GAP_MS,
  slackGetMessageGroupStyle,
} from "../../../../lib/message-grouping";

export default function ThreadScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>();
  const { client } = useChatContext();
  const { channel: contextChannel, thread, setThread } = useAppContext();
  const [channel, setChannel] = useState<ChannelType | undefined>(
    contextChannel,
  );
  const headerHeight = useHeaderHeight();
  const headerHeightRef = useRef(headerHeight);

  useEffect(() => {
    if (channel || !cid) return;
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

  if (!channel || !thread) {
    return (
      <SafeAreaView>
        <Text>Loading chat ...</Text>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Thread" }} />
      {/* Same custom attachment renderers as the channel screen. */}
      <CustomAttachmentProvider>
      <Channel
        channel={channel}
        keyboardVerticalOffset={headerHeightRef.current}
        topInset={headerHeightRef.current}
        thread={thread}
        threadList
        // Threads cluster the same way as the main list (web does this for its
        // thread panel too).
        getMessageGroupStyle={slackGetMessageGroupStyle}
        maxTimeBetweenGroupedMessages={CLUSTER_TIME_GAP_MS}
      >
        <Thread onThreadDismount={() => setThread(null)} />
      </Channel>
      </CustomAttachmentProvider>
    </>
  );
}
