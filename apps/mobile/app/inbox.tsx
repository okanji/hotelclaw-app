import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Linking, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { apiBaseUrl } from "../chatConfig";
import { useAuth } from "../contexts/AuthContext";
import { usePropertyContext } from "../contexts/PropertyContext";
import { dayLabel, timeAgo } from "../lib/activity";
import {
  notificationView,
  useNotifications,
  type NotificationRow,
} from "../lib/notifications";

type Filter = "all" | "unread" | "mentions" | "tasks" | "alerts";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mentions", label: "Mentions" },
  { id: "tasks", label: "Tasks" },
  { id: "alerts", label: "Alerts" },
];

/** Same slices as web's Activity sidebar (`views.ts:matchesView`). */
function matches(n: NotificationRow, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "unread":
      return !n.seen_at;
    case "mentions":
      return n.type === "mention" || n.type === "task_comment_mention";
    case "tasks":
      return ["task_assigned", "task_unassigned", "task_escalated"].includes(n.type);
    case "alerts":
      return ["guest_escalation", "project_at_risk", "task_slip", "insight_alert", "workflow"].includes(n.type);
  }
}

/**
 * Inbox — what needs you: assignments, mentions, escalations, alerts. The
 * phone twin of the web Activity section. Tapping a row marks it read and
 * opens the task / channel / project; things only the web has open there.
 */
export default function InboxScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { activeProperty, setActivePropertyId, memberships } = usePropertyContext();
  const { rows, error, unseenCount, reload, markRead } = useNotifications(session?.user.id);
  const [filter, setFilter] = useState<Filter>("all");

  const sections = useMemo(() => {
    const visible = (rows ?? []).filter((n) => matches(n, filter));
    const out: { key: string; title: string; data: NotificationRow[] }[] = [];
    for (const n of visible) {
      const key = n.created_at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.key === key) last.data.push(n);
      else out.push({ key, title: dayLabel(n.created_at), data: [n] });
    }
    return out;
  }, [rows, filter]);

  function open(n: NotificationRow) {
    if (!n.seen_at) markRead([n.id]);
    const v = notificationView(n);
    // A row can belong to another property; follow it there when we're a member.
    if (n.property_id && n.property_id !== activeProperty?.property_id) {
      if (memberships.some((m) => m.property_id === n.property_id)) setActivePropertyId(n.property_id);
    }
    if (!v.target) return;
    switch (v.target.kind) {
      case "task":
        router.navigate({ pathname: "/task/[taskId]", params: { taskId: v.target.taskId } });
        return;
      case "project":
        router.navigate({ pathname: "/project/[projectId]", params: { projectId: v.target.projectId } });
        return;
      case "channel":
        router.navigate({ pathname: "/channel/[cid]", params: { cid: v.target.cid } });
        return;
      case "web": {
        const pid = n.property_id ?? activeProperty?.property_id;
        const path = v.target.path.startsWith("/invites")
          ? v.target.path
          : pid
            ? `/p/${pid}${v.target.path}`
            : null;
        if (path) void Linking.openURL(`${apiBaseUrl}${path}`);
      }
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Inbox",
          headerRight: () =>
            unseenCount > 0 ? (
              <Pressable hitSlop={8} onPress={() => markRead("all")} accessibilityLabel="Mark all read">
                <Ionicons name="checkmark-done-outline" size={22} color="#111827" />
              </Pressable>
            ) : null,
        }}
      />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[styles.chip, filter === f.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
              {f.label}
              {f.id === "unread" && unseenCount > 0 ? ` ${unseenCount}` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : rows === null ? (
        <Loading label="Loading inbox…" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          stickySectionHeadersEnabled={false}
          onRefresh={() => void reload()}
          refreshing={false}
          contentContainerStyle={sections.length === 0 ? styles.emptyContent : styles.content}
          ListEmptyComponent={
            <EmptyState
              icon="mail-open-outline"
              title={filter === "all" ? "You're all caught up" : "Nothing here"}
              body={
                filter === "all"
                  ? "Mentions, assignments and alerts land here."
                  : "Try another filter."
              }
            />
          }
          renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
          renderItem={({ item }) => {
            const v = notificationView(item);
            const unseen = !item.seen_at;
            return (
              <Pressable
                onPress={() => open(item)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.glyph, unseen && styles.glyphUnseen]}>
                  <Ionicons
                    name={v.icon as keyof typeof Ionicons.glyphMap}
                    size={16}
                    color={unseen ? "#111827" : "#6b7280"}
                  />
                </View>
                <View style={styles.main}>
                  <Text style={[styles.lead, unseen && styles.leadUnseen]} numberOfLines={2}>
                    {v.lead}
                  </Text>
                  {v.sub ? (
                    <Text style={styles.sub} numberOfLines={2}>
                      {v.sub}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.trailing}>
                  {unseen ? <View style={styles.dot} /> : null}
                  <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "#f3f4f6" },
  chipActive: { backgroundColor: "#111827" },
  chipText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  chipTextActive: { color: "#ffffff" },
  content: { paddingBottom: 32 },
  emptyContent: { flexGrow: 1 },
  day: { fontSize: 12, fontWeight: "600", color: "#9ca3af", paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  rowPressed: { backgroundColor: "#f9fafb" },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  glyphUnseen: { backgroundColor: "#e5e7eb" },
  main: { flex: 1, gap: 2 },
  lead: { fontSize: 15, lineHeight: 20, color: "#374151" },
  leadUnseen: { color: "#111827", fontWeight: "600" },
  sub: { fontSize: 13, color: "#6b7280" },
  trailing: { alignItems: "flex-end", gap: 4, paddingTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2563eb" },
  time: { fontSize: 12, color: "#9ca3af", fontVariant: ["tabular-nums"] },
});
