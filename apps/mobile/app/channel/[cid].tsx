import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
// SDK 56: import react-navigation APIs via expo-router, not @react-navigation/*
import { useHeaderHeight } from "expo-router/react-navigation";
import {
  Channel,
  MessageComposer,
  MessageList,
  TypingIndicator,
  TypingIndicatorContainer,
  useChatContext,
} from "stream-chat-expo";
import { Ionicons } from "@expo/vector-icons";
import { AiThinkingIndicator } from "../../components/AiThinkingIndicator";
import { AiModeSheet } from "../../components/AiModeSheet";
import { MentionTextInput } from "../../components/MentionTextInput";
import type { Channel as ChannelType } from "stream-chat";
import { useAppContext } from "../../contexts/AppContext";
import { usePropertyContext } from "../../contexts/PropertyContext";
import { CustomAttachmentProvider } from "../../components/attachments/CustomAttachments";
import {
  CLUSTER_TIME_GAP_MS,
  slackGetMessageGroupStyle,
} from "../../lib/message-grouping";

export default function ChannelScreen() {
  const router = useRouter();
  const { cid } = useLocalSearchParams<{ cid: string }>();
  const { client } = useChatContext();
  const { channel: contextChannel, thread, setThread } = useAppContext();
  const {
    activeProperty,
    memberships,
    loading: propertiesLoading,
    setActivePropertyId,
  } = usePropertyContext();
  const [channel, setChannel] = useState<ChannelType | undefined>(
    contextChannel,
  );
  const [error, setError] = useState<string | null>(null);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
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
    newChannel
      .watch()
      .then(() => {
        if (active) setChannel(newChannel);
      })
      .catch((err: unknown) => {
        // Without this the screen spins forever on a deleted channel or a
        // channel the user isn't a member of (Stream rejects the watch).
        if (!active) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(
          /not allowed|permission/i.test(message)
            ? "You don't have access to this channel."
            : "This channel couldn't be opened.",
        );
      });
    return () => {
      active = false;
    };
  }, [cid, channel, client]);

  // Tenancy: a deep link can point at a channel in a different property than
  // the one currently selected. Follow the channel rather than showing its
  // messages under the wrong property name — the web app does the same thing
  // implicitly, because the property id is in the URL.
  const channelPropertyId = channel?.data?.property_id;
  useEffect(() => {
    if (!channelPropertyId || propertiesLoading) return;
    if (activeProperty?.property_id === channelPropertyId) return;
    if (memberships.some((m) => m.property_id === channelPropertyId)) {
      setActivePropertyId(channelPropertyId);
    }
  }, [
    channelPropertyId,
    activeProperty,
    memberships,
    propertiesLoading,
    setActivePropertyId,
  ]);

  // Belt and braces: Stream already refuses non-members, but never render a
  // channel from a property this account has no membership in.
  const outsideTenant =
    !!channelPropertyId &&
    !propertiesLoading &&
    !memberships.some((m) => m.property_id === channelPropertyId);

  if (error || outsideTenant) {
    return (
      <>
        <Stack.Screen options={{ title: "Unavailable" }} />
        <View style={styles.center}>
          <Text style={styles.title}>Can&apos;t open this channel</Text>
          <Text style={styles.body}>
            {error ?? "It belongs to a property you're not a member of."}
          </Text>
          <Pressable style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (!channel) {
    return (
      <>
        <Stack.Screen options={{ title: "" }} />
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: channel.data?.name ?? "Channel",
          // Channel-wide AI reply settings (mode + sensitivity) — the mobile
          // counterpart of web's channel-header AI button.
          headerRight: () => (
            <Pressable
              onPress={() => setAiSheetOpen(true)}
              hitSlop={10}
              accessibilityLabel="AI assistant settings"
            >
              <Ionicons name="sparkles-outline" size={20} color="#111827" />
            </Pressable>
          ),
        }}
      />
      <AiModeSheet
        channel={channel}
        visible={aiSheetOpen}
        onClose={() => setAiSheetOpen(false)}
      />
      {/* Custom attachment renderers (ai_ui / form / app_artifact) — see
          components/attachments/CustomAttachments.tsx for the mechanism. */}
      <CustomAttachmentProvider>
      <Channel
        channel={channel}
        keyboardVerticalOffset={headerHeightRef.current}
        topInset={headerHeightRef.current}
        thread={thread}
        // Same clustering as web — shared rules, not a reimplementation.
        getMessageGroupStyle={slackGetMessageGroupStyle}
        maxTimeBetweenGroupedMessages={CLUSTER_TIME_GAP_MS}
      >
        <MessageList
          // The RN list is inverted, so `ListHeaderComponent` renders at the
          // VISUAL BOTTOM — the same place web portals its thinking row into,
          // so it scrolls with the conversation instead of sitting pinned above
          // the composer. The SDK owns this slot for the typing indicator, and
          // additionalFlatListProps is spread after it, so re-render the typing
          // indicator here too rather than silently dropping it.
          additionalFlatListProps={{
            ListHeaderComponent: (
              <>
                <AiThinkingIndicator streamChannelId={channel.id ?? ""} />
                <TypingIndicatorContainer>
                  <TypingIndicator />
                </TypingIndicatorContainer>
              </>
            ),
          }}
          onThreadSelect={(message) => {
            setThread(message);
            // navigate (not push) so a double-tap can't stack the screen
            router.navigate({
              pathname: "/channel/[cid]/thread/[messageId]",
              params: { cid: channel.cid, messageId: message?.id ?? "" },
            });
          }}
        />
        {/* Mention-aware input: committed @-mentions render bold+blue while
            typing (components/MentionTextInput.tsx). */}
        <MessageComposer TextInputComponent={MentionTextInput} />
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
