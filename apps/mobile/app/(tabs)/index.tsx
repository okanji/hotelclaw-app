import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChannelListPane } from "../../components/ChannelListPane";
import { initialsFor, ScreenHeader } from "../../components/ScreenHeader";
import { usePropertyContext } from "../../contexts/PropertyContext";

export default function ChannelsTab() {
  const router = useRouter();
  const { activeProperty } = usePropertyContext();
  const name = activeProperty?.property.name;

  return (
    <View style={styles.container}>
      {/* Slack's header shape: workspace tile + name, compact. The name tells
          you which org you're in; it is deliberately NOT the switcher (that
          lives in You). */}
      <ScreenHeader
        title={name ?? "Channels"}
        badgeLabel={name ? initialsFor(name) : undefined}
        accessory={
          // The assistant is the one AI surface worth a header slot: it is
          // a daily driver, not a setting (same reasoning as the web rail).
          <Pressable
            onPress={() => router.navigate("/assistant")}
            hitSlop={8}
            accessibilityLabel="Open the assistant"
            style={styles.assistantButton}
          >
            <Ionicons name="sparkles-outline" size={18} color="#111827" />
          </Pressable>
        }
      />
      <ChannelListPane kind="team" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  assistantButton: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
  },
});
