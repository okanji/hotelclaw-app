import { Stack, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Loading, Pill, Row } from "../components/ui";
import { usePropertyContext } from "../contexts/PropertyContext";
import {
  ENTITY_COLOR,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  formatDateOnly,
  useProjects,
  type ProjectStatus,
  type ProjectSummary,
} from "../lib/projects";

type Scope = "active" | "all";

/**
 * Projects — the property's initiatives with their progress, the phone twin
 * of the web Projects table. Tapping opens the project (overview, milestones,
 * tasks, who-did-what).
 */
export default function ProjectsScreen() {
  const router = useRouter();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const { rows, error, reload } = useProjects(propertyId);
  const [scope, setScope] = useState<Scope>("active");

  const visible = useMemo(() => {
    const all = rows ?? [];
    const list = scope === "active" ? all.filter((p) => p.status === "active" || p.status === "planned") : all;
    const order: ProjectStatus[] = ["active", "planned", "completed", "archived"];
    return [...list].sort(
      (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name),
    );
  }, [rows, scope]);

  if (!propertyId) return <EmptyState title="Pick a property first" />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Projects" }} />
      <View style={styles.chips}>
        {(
          [
            { id: "active", label: "In flight" },
            { id: "all", label: "All" },
          ] as { id: Scope; label: string }[]
        ).map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setScope(c.id)}
            style={[styles.chip, scope === c.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, scope === c.id && styles.chipTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : rows === null ? (
        <Loading label="Loading projects…" />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(p) => p.id}
          onRefresh={() => void reload()}
          refreshing={false}
          contentContainerStyle={visible.length === 0 ? styles.emptyContent : styles.content}
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              title={rows.length === 0 ? "No projects yet" : "Nothing in flight"}
              body={rows.length === 0 ? "Projects are created on the web app." : "Switch to All to see finished ones."}
            />
          }
          renderItem={({ item }) => (
            <ProjectRowItem
              project={item}
              onPress={() =>
                router.navigate({ pathname: "/project/[projectId]", params: { projectId: item.id } })
              }
            />
          )}
        />
      )}
    </View>
  );
}

function ProjectRowItem({ project, onPress }: { project: ProjectSummary; onPress: () => void }) {
  const pct = project.total ? Math.round((project.done / project.total) * 100) : 0;
  const target = formatDateOnly(project.target_date);
  return (
    <Row onPress={onPress}>
      <View style={styles.rowTop}>
        <View style={[styles.dot, { backgroundColor: ENTITY_COLOR[project.color] ?? ENTITY_COLOR.slate }]} />
        <Text style={styles.name} numberOfLines={1}>
          {project.icon ? `${project.icon} ` : ""}
          {project.name || "Untitled project"}
        </Text>
        <Pill label={PROJECT_STATUS_LABEL[project.status]} color={PROJECT_STATUS_COLOR[project.status]} />
      </View>
      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.pct}>{pct}%</Text>
      </View>
      <Text style={styles.meta}>
        {project.done}/{project.total} tasks done
        {target ? ` · target ${target}` : ""}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "#f3f4f6" },
  chipActive: { backgroundColor: "#111827" },
  chipText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  chipTextActive: { color: "#ffffff" },
  content: { paddingBottom: 32 },
  emptyContent: { flexGrow: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: "#111827" },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "#e5e7eb", overflow: "hidden" },
  fill: { height: 6, backgroundColor: "#111827" },
  pct: { width: 38, textAlign: "right", fontSize: 12, fontWeight: "600", color: "#111827", fontVariant: ["tabular-nums"] },
  meta: { marginTop: 6, fontSize: 13, color: "#6b7280" },
});
