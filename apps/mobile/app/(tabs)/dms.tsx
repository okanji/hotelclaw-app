import React from "react";
import { StyleSheet, View } from "react-native";
import { ChannelListPane } from "../../components/ChannelListPane";
import { ScreenHeader } from "../../components/ScreenHeader";

export default function DmsTab() {
  return (
    <View style={styles.container}>
      <ScreenHeader title="Direct messages" />
      {/* DMs carry property_id like channels, so this list is tenant-scoped
          too — a DM in another property appears only after switching to it. */}
      <ChannelListPane kind="messaging" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
});
