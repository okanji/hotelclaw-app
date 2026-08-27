import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
// SDK 56: import react-navigation APIs via expo-router, not @react-navigation/*
import { useHeaderHeight } from "expo-router/react-navigation";
import { Channel, Thread, useChatContext } from "stream-chat-expo";
import { formatMessage, type Channel as ChannelType } from "stream-chat";
import { useAppContext } from "../../../../contexts/AppContext";
import { CustomAttachmentProvider } from "../../../../components/attachments/CustomAttachments";
import { MentionTextInput } from "../../../../components/MentionTextInput";
import {
  CLUSTER_TIME_GAP_MS,
  slackGetMessageGroupStyle,
} from "../../../../lib/message-grouping";

export default function ThreadScreen() {
  const router = useRouter();
  const { cid, messageId } = useLocalSearchParams<{
    cid: string;
    messageId: string;
  }>();
  const { client } = useChatContext();
  const { channel: contextChannel, thread, setThread } = useAppContext();
  // Same guard as the channel screen: only adopt the context channel when it
  // matches the route param, so a warm deep link can't render the wrong one.
  const [channel, setChannel] = useState<ChannelType | undefined>(() =>
    contextChannel?.cid === cid ? contextChannel : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    if (channel || !cid) return;
    const [channelType, channelId] = cid.includes(":")
      ? (cid.split(":") as [string, string])
      : (["team", cid] as [string, string]);
    const newChannel = client.channel(channelType, channelId);
    let active = true;
    newChannel
      .watch()
      .then(() => {
        if (active) setChannel(newChannel);
      })
      .catch((err: unknown) => {
        // Same failure-state rule as the channel screen: a rejected watch
        // (deleted channel, non-member) must surface, not spin forever.
        if (!active) return;
        console.warn("[thread] watch failed", cid, err);
        const message = err instanceof Error ? err.message : String(err);
        setError(
          /not allowed|permission/i.test(message)
            ? "You don't have access to this thread."
            : "This thread couldn't be opened.",
        );
      });
    return () => {
      active = false;
    };
  }, [cid, channel, client]);

  // Cold deep link: nothing handed the parent message through context, so
  // fetch it by the route's messageId — without this the screen could only
  // ever load when reached via onThreadSelect.
  useEffect(() => {
    if (thread || !messageId || !channel) return;
    let active = true;
    client
      .getMessage(messageId)
      .then((res) => {
        if (active) setThread(formatMessage(res.message));
      })
      .catch((err: unknown) => {
        if (!active) return;
        console.warn("[thread] getMessage failed", messageId, err);
        setError("This thread couldn't be opened.");
      });
    return () => {
      active = false;
    };
  }, [thread, messageId, channel, client, setThread]);

  if (error) {
    return (
      <>
        <Stack.Screen options={{ title: "Thread" }} />
        <View style={styles.center}>
          <Text style={styles.title}>Can&apos;t open this thread</Text>
          <Text style={styles.body}>{error}</Text>
          <Pressable style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (!channel || !thread) {
    return (
      <>
        <Stack.Screen options={{ title: "Thread" }} />
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Thread" }} />
      {/* Same custom attachment renderers as the channel screen. */}
      <CustomAttachmentProvider>
      <Channel
        channel={channel}
        keyboardVerticalOffset={headerHeight}
        topInset={headerHeight}
        thread={thread}
        threadList
        // Threads cluster the same way as the main list (web does this for its
        // thread panel too).
        getMessageGroupStyle={slackGetMessageGroupStyle}
        maxTimeBetweenGroupedMessages={CLUSTER_TIME_GAP_MS}
      >
        <Thread
          onThreadDismount={() => setThread(null)}
          // Same scroll-to-dismiss-keyboard behavior as the channel screen.
          additionalMessageListProps={{
            additionalFlatListProps: {
              keyboardDismissMode:
                Platform.OS === "ios" ? "interactive" : "on-drag",
            },
          }}
          // Same mention-aware input as the channel composer.
          additionalMessageComposerProps={{
            TextInputComponent: MentionTextInput,
          }}
        />
      </Channel>
      </CustomAttachmentProvider>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  body: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
  },
  button: {
    marginTop: 8,
    backgroundColor: "#111827",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
});
