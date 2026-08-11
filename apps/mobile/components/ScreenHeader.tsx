import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Compact nav bar for the tab screens (NativeTabs supplies no header).
 *
 * Deliberately sized like Slack's mobile header: a small square workspace tile,
 * the name at body-ish weight, and one row of chrome — NOT a large title. The
 * list is the content; the header just says where you are.
 */
export function ScreenHeader({
  title,
  badgeLabel,
  accessory,
}: {
  title: string;
  /** Short initials shown in the leading square tile (workspace avatar). */
  badgeLabel?: string;
  accessory?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      {badgeLabel ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeLabel}</Text>
        </View>
      ) : null}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.spacer} />
      {accessory}
    </View>
  );
}

/** "Solana Cove Resort & Spa" -> "SC" */
export function initialsFor(name: string | undefined) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words
    .filter((w) => /[a-z0-9]/i.test(w[0]))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return letters || name[0].toUpperCase();
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
});
