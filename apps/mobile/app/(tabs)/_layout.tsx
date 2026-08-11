import React from "react";
import { NativeTabs } from "expo-router/unstable-native-tabs";

/**
 * Bottom tab bar, following Slack's mobile model: Home / DMs / You, with the
 * workspace (property) switcher living inside You rather than the header —
 * switching org is rare, so it shouldn't occupy prime navigation space.
 *
 * SDK 56 note: `Tabs` from the expo-router root export is deprecated.
 * `NativeTabs` renders a real UIKit tab bar and takes SF Symbols directly, so
 * it needs no icon dependency (this app has none installed).
 */
export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }}
        />
        <NativeTabs.Trigger.Label>Channels</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="dms">
        <NativeTabs.Trigger.Icon
          sf={{ default: "paperplane", selected: "paperplane.fill" }}
        />
        <NativeTabs.Trigger.Label>DMs</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.Icon
          sf={{ default: "checkmark.circle", selected: "checkmark.circle.fill" }}
        />
        <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Icon
          sf={{ default: "calendar", selected: "calendar" }}
        />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
        />
        <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
