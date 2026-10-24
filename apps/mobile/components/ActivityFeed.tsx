import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import {
  dayLabel,
  describeActivity,
  timeAgo,
  type ActivityLookup,
  type ActivityRow,
} from "../lib/activity";
import { initialsFor } from "./ScreenHeader";
import { EmptyState } from "./ui";

/**
 * One activity sentence: avatar · **Actor** verb *Object* extra · time.
 * Tapping opens the task or project. `showProject` appends "in <project>"
 * on feeds that span projects.
 */
export function ActivityItem({
  row,
  lookup,
  showProject,
}: {
  row: ActivityRow;
  lookup: ActivityLookup;
  showProject?: boolean;
}) {
  const router = useRouter();
  const d = describeActivity(row, lookup);
  const open = () => {
    if (!d.target) return;
    if (d.target.kind === "task")
      router.navigate({ pathname: "/task/[taskId]", params: { taskId: d.target.id } });
    else router.navigate({ pathname: "/project/[projectId]", params: { projectId: d.target.id } });
  };
  const glyph: keyof typeof Ionicons.glyphMap =
    row.actor_kind === "workflow"
      ? "flash-outline"
      : row.actor_kind === "ai"
        ? "sparkles-outline"
        : "person-outline";
  return (
    <Pressable
      onPress={open}
      disabled={!d.target}
      style={({ pressed }) => [styles.item, pressed && d.target ? styles.itemPressed : null]}
    >
      <View style={styles.avatar}>
        {d.actorInitialsFrom ? (
          <Text style={styles.avatarText}>{initialsFor(d.actorInitialsFrom)}</Text>
        ) : (
          <Ionicons name={glyph} size={13} color="#6b7280" />
        )}
      </View>
      <Text style={styles.sentence}>
        <Text style={styles.actor}>{d.actor}</Text> {d.verb}{" "}
        <Text style={styles.object}>{d.object}</Text>
        {d.extra ? ` ${d.extra}` : ""}
        {showProject && d.project && row.entity_kind !== "project" ? (
          <Text style={styles.faint}> in {d.project.name}</Text>
        ) : null}
      </Text>
      <Text style={styles.time}>{timeAgo(row.created_at)}</Text>
    </Pressable>
  );
}

/** Day-bucketed feed. Pass `header` for anything above the first day. */
export function ActivityFeed({
  rows,
  lookup,
  showProject,
  emptyTitle = "No activity yet",
  emptyBody = "Changes to tasks and projects will appear here, with who made them.",
  header,
  refreshing,
  onRefresh,
}: {
  rows: ActivityRow[];
  lookup: ActivityLookup;
  showProject?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  header?: React.ReactElement | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const sections = useMemo(() => {
    const out: { key: string; title: string; data: ActivityRow[] }[] = [];
    for (const r of rows) {
      const key = r.created_at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.key === key) last.data.push(r);
      else out.push({ key, title: dayLabel(r.created_at), data: [r] });
    }
    return out;
  }, [rows]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(r) => r.id}
      stickySectionHeadersEnabled={false}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={header ?? null}
      ListEmptyComponent={<EmptyState icon="pulse-outline" title={emptyTitle} body={emptyBody} />}
      contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.content}
      renderSectionHeader={({ section }) => (
        <Text style={styles.day}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <ActivityItem row={item} lookup={lookup} showProject={showProject} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  emptyContent: { flexGrow: 1 },
  day: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  itemPressed: { backgroundColor: "#f9fafb" },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  avatarText: { fontSize: 10, fontWeight: "600", color: "#4b5563" },
  sentence: { flex: 1, fontSize: 15, lineHeight: 21, color: "#6b7280" },
  actor: { fontWeight: "600", color: "#111827" },
  object: { fontWeight: "500", color: "#111827" },
  faint: { color: "#9ca3af" },
  time: {
    fontSize: 12,
    color: "#9ca3af",
    fontVariant: ["tabular-nums"],
    paddingTop: 3,
  },
});
