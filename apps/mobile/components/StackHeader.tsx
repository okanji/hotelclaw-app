import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const ROW_HEIGHT = 36;

/**
 * Compact header for pushed chat screens (channel, thread).
 *
 * The native-stack default on Android is a 64dp bar with a 22sp title — a
 * Material top app bar, far taller than a chat screen needs. This is the
 * pushed-screen twin of `ScreenHeader`: one 36pt row, 16pt title, an optional
 * trailing control.
 *
 * It renders INSIDE the screen (the route sets `headerShown: false`) rather
 * than through the stack's `header` option: native-stack lays a custom header
 * out above a content view that is still sized to the full screen, which
 * pushed Stream's composer off the bottom edge on Android.
 */
export function StackHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        {router.canGoBack() ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

/**
 * The header's height — what Stream's `Channel` needs as
 * `keyboardVerticalOffset` / `topInset` (useHeaderHeight() is 0 once the
 * stack header is hidden).
 */
export function useStackHeaderHeight() {
  return useSafeAreaInsets().top + ROW_HEIGHT + StyleSheet.hairlineWidth;
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 4,
  },
  back: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    paddingHorizontal: 4,
  },
  right: {
    paddingHorizontal: 8,
  },
});
