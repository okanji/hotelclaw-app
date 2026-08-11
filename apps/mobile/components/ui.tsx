import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { TaskPriority, TaskStatus } from "../lib/api";

/** Loading / error / empty, so no screen invents its own (and none of them can
 *  fail silently by showing an empty list when the fetch actually broke). */
export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
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
}: {
  title: string;
  body?: string;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
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
        filled
          ? { backgroundColor: color }
          : { borderWidth: 1, borderColor: color },
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
