import React from "react";
import { StyleSheet, View } from "react-native";
import { ChannelListPane } from "../../components/ChannelListPane";
import { initialsFor, ScreenHeader } from "../../components/ScreenHeader";
import { usePropertyContext } from "../../contexts/PropertyContext";

export default function ChannelsTab() {
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
      />
      <ChannelListPane kind="team" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
});
