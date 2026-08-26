import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";

/**
 * Bottom tab bar, following Slack's mobile model: Home / DMs / You, with the
 * workspace (property) switcher living inside You rather than the header —
 * switching org is rare, so it shouldn't occupy prime navigation space.
 *
 * PLATFORM FORK. iOS keeps `NativeTabs` (a real UIKit tab bar taking SF
 * Symbols directly). Android does NOT get NativeTabs: SF Symbols don't exist
 * there, and in the 2026-08-24 Android smoke test NativeTabs rendered only
 * the FIRST trigger — four of five tabs simply missing. Android uses the
 * classic JS `Tabs` with Ionicons instead (deprecated on iOS in favor of
 * NativeTabs, still fully supported as a cross-platform tab bar).
 */

const ANDROID_TABS: {
  name: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconFocused: keyof typeof Ionicons.glyphMap;
}[] = [
  { name: "index", title: "Channels", icon: "chatbubbles-outline", iconFocused: "chatbubbles" },
  { name: "dms", title: "DMs", icon: "paper-plane-outline", iconFocused: "paper-plane" },
  { name: "tasks", title: "Tasks", icon: "checkmark-circle-outline", iconFocused: "checkmark-circle" },
  { name: "calendar", title: "Calendar", icon: "calendar-outline", iconFocused: "calendar" },
  { name: "you", title: "You", icon: "person-circle-outline", iconFocused: "person-circle" },
];

function AndroidTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#111827",
        tabBarInactiveTintColor: "#9ca3af",
      }}
    >
      {ANDROID_TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? tab.iconFocused : tab.icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

function IosTabsLayout() {
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

export default function TabsLayout() {
  return Platform.OS === "ios" ? <IosTabsLayout /> : <AndroidTabsLayout />;
}
