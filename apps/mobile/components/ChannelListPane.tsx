import { useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ChannelList, useChatContext } from "stream-chat-expo";
import type {
  Channel as ChannelType,
  ChannelFilters,
  ChannelOptions,
  ChannelSort,
  Event,
} from "stream-chat";
import { useAppContext } from "../contexts/AppContext";
import { useAuth } from "../contexts/AuthContext";
import { usePropertyContext } from "../contexts/PropertyContext";

const sort: ChannelSort = { last_message_at: -1 };

const options: ChannelOptions = {
  limit: 20,
  presence: true,
  state: true,
  watch: true,
};

/**
 * The channel list for one Stream channel type, scoped to the active property.
 * Channels and DMs are the same query with `kind` swapped — the same split web
 * makes with two `ChannelListSection`s (`channelKind` "team" / "messaging").
 */
export function ChannelListPane({ kind }: { kind: "team" | "messaging" }) {
  const router = useRouter();
  const { setChannel } = useAppContext();
  const { client } = useChatContext();
  const { session } = useAuth();
  const { activeProperty, loading, error, reload } = usePropertyContext();

  const userId = session?.user.id ?? "";
  const propertyId = activeProperty?.property_id;

  // Mirrors apps/web/components/chat/channel-list/channel-list-section.tsx:
  // channels the user is a member of, in this tenant, excluding archived
  // (frozen) ones.
  const filters: ChannelFilters = useMemo(
    () => ({
      members: { $in: [userId] },
      type: kind,
      property_id: propertyId,
      frozen: false,
    }),
    [userId, propertyId, kind],
  );

  // Stream's default live-event handlers promote ANY channel with new activity
  // into the list — they only consult the `archived` filter, not type or
  // property_id (ChannelManager.notificationNewMessageHandler in stream-chat).
  // Left alone, a new DM pops into Channels and a channel from another property
  // pops into both. Web uses `allowNewMessagesFromUnfilteredChannels={false}`;
  // the RN SDK has no such flag, so enforce the same rule by hand.
  const admitChannel = useCallback(
    async (
      setChannels: React.Dispatch<React.SetStateAction<ChannelType[]>>,
      event: Event,
    ) => {
      // `message.new` carries channel_type/channel_id; the notification.* events
      // carry a nested `channel`. Handle both.
      const type = event.channel?.type ?? event.channel_type;
      const id = event.channel?.id ?? event.channel_id;
      if (!id || !type || type !== kind) return;
      const channel = client.channel(type, id);
      if (!channel.initialized) await channel.watch();
      if (channel.data?.property_id !== propertyId) return;
      setChannels((prev) => [
        channel,
        ...prev.filter((c) => c.cid !== channel.cid),
      ]);
    },
    [client, kind, propertyId],
  );

  // `message.new` needs its own signature (lockChannelOrder comes first) and is
  // the one that actually bit: typing in a team channel while the DMs tab was
  // mounted promoted that channel into the DM list.
  const admitOnNewMessage = useCallback(
    (
      lockChannelOrder: boolean,
      setChannels: React.Dispatch<React.SetStateAction<ChannelType[]>>,
      event: Event,
    ) => {
      if (lockChannelOrder) return;
      void admitChannel(setChannels, event);
    },
    [admitChannel],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  // A failed fetch must not masquerade as "you have no properties" — that reads
  // as an account problem and offers no way forward.
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Couldn&apos;t load properties</Text>
        <Text style={styles.emptyBody}>{error}</Text>
        <Pressable style={styles.retry} onPress={reload}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!propertyId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No properties yet</Text>
        <Text style={styles.emptyBody}>
          Accept an invite or finish onboarding on the web app.
        </Text>
      </View>
    );
  }

  return (
    <ChannelList
      // Remount on tenant switch so stale channels never bleed through.
      key={`${userId}:${propertyId}:${kind}`}
      filters={filters}
      options={options}
      sort={sort}
      onNewMessage={admitOnNewMessage}
      onNewMessageNotification={admitChannel}
      onAddedToChannel={admitChannel}
      onSelect={(channel) => {
        setChannel(channel);
        // `navigate`, not `push`: the channel screen takes a beat to load, so
        // a double-tap on a slow row would stack the screen twice and Back
        // would have to be pressed twice. navigate dedupes same-route+params.
        router.navigate({
          pathname: "/channel/[cid]",
          params: { cid: channel.cid },
        });
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  emptyBody: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
  },
  retry: {
    marginTop: 8,
    backgroundColor: "#111827",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
});
