import { Ionicons } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TaskPriority, TaskStatus } from "../lib/api";
import { AiPixelGrid, AiShimmerLabel } from "./AiLoader";

/**
 * Root container for a full-screen Modal sheet.
 *
 * On iOS, `presentationStyle="pageSheet"` floats the modal as a card below
 * the status bar, so no inset is needed. Android IGNORES presentationStyle
 * and renders the modal edge-to-edge behind the system bars — without
 * padding, the sheet's header bar sits under the status-bar clock and the
 * camera punch-hole, and its bottom row under the gesture nav (seen live on
 * the 2026-08-25 Android pass: "Cancel"/"Save" overlapped by white
 * status-bar text). Every Modal sheet must use this as its root.
 */
export function SheetSurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.sheetSurface,
        Platform.OS === "android"
          ? { paddingTop: insets.top, paddingBottom: insets.bottom }
          : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Loading / error / empty, so no screen invents its own (and none of them can
 *  fail silently by showing an empty list when the fetch actually broke).
 *  Never a bare spinner (Beautiful UI rule) — the house pixel grid + a
 *  shimmering label, same visual as every AI wait. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <View style={styles.loadingRow}>
        <AiPixelGrid />
        <AiShimmerLabel style={styles.loadingLabel}>{label}</AiShimmerLabel>
      </View>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  icon,
}: {
  title: string;
  body?: string;
  /** Inset icon tile above the title — the SearchList empty-state recipe.
   *  Pass for search/filter "no results" states. */
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.center}>
      {icon ? (
        <View style={styles.emptyTile}>
          <Ionicons name={icon} size={22} color="#9ca3af" />
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

/** Count badge — Beautiful UI recipe: inset fill, hairline, tabular figures.
 *  `tone="onDark"` inverts it for use inside a dark active chip. */
export function CountBadge({
  count,
  tone = "default",
}: {
  count: number;
  tone?: "default" | "onDark";
}) {
  return (
    <View style={[styles.countBadge, tone === "onDark" && styles.countBadgeOnDark]}>
      <Text
        style={[
          styles.countBadgeText,
          tone === "onDark" && styles.countBadgeTextOnDark,
        ]}
      >
        {count}
      </Text>
    </View>
  );
}


export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

// Mirrors the web status ramp closely enough to be recognisable without
// importing the web token layer (which is CSS custom properties).
export const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "#6b7280",
  in_progress: "#2563eb",
  blocked: "#dc2626",
  done: "#16a34a",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  none: "#9ca3af",
  low: "#6b7280",
  medium: "#d97706",
  high: "#ea580c",
  urgent: "#dc2626",
};

/** Status pill — Beautiful UI grammar: hue TINT fill + same-hue ink
 *  (never an outline border). `filled` keeps the solid variant for the rare
 *  emphasized case. */
export function Pill({
  label,
  color,
  filled,
}: {
  label: string;
  color: string;
  filled?: boolean;
}) {
  return (
    <View
      style={[
        styles.pill,
        // 6-digit hex + "1F" = ~12% alpha tint of the same hue.
        filled ? { backgroundColor: color } : { backgroundColor: `${color}1F` },
      ]}
    >
      <Text style={[styles.pillText, { color: filled ? "#ffffff" : color }]}>
        {label}
      </Text>
    </View>
  );
}

export function Row({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

/** "in 2 days" / "3 days ago" / "today" — enough for due dates and agendas. */
export function relativeDay(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(then) - startOf(new Date())) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `In ${days} days`;
}

export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dayHeading(iso: string): string {
  const d = new Date(iso);
  const rel = relativeDay(iso);
  const label = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return rel === "Today" || rel === "Tomorrow" ? `${rel} · ${label}` : label;
}

const styles = StyleSheet.create({
  sheetSurface: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 8,
  },
  title: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 15, color: "#6b7280", textAlign: "center" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  loadingLabel: { fontSize: 13 },
  emptyTile: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  countBadge: {
    height: 18,
    minWidth: 18,
    paddingHorizontal: 5,
    borderRadius: 5,
    backgroundColor: "#f3f4f6",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeOnDark: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderColor: "transparent",
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
    fontVariant: ["tabular-nums"],
  },
  countBadgeTextOnDark: { color: "#ffffff" },
  button: {
    marginTop: 8,
    backgroundColor: "#111827",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 12, fontWeight: "600" },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  rowPressed: { backgroundColor: "#f9fafb" },
});
