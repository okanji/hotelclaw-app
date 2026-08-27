import { Stack, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AiPixelGrid, AiShimmerLabel } from "../../components/AiLoader";
import { TriageSuggestions } from "../../components/TriageSuggestions";
import {
  ErrorState,
  Loading,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  relativeDay,
} from "../../components/ui";
import { usePropertyContext } from "../../contexts/PropertyContext";
import {
  apiFetch,
  useApi,
  type ApiMember,
  type ApiTask,
  type TaskPriority,
  type TaskStatus,
} from "../../lib/api";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const PRIORITIES: TaskPriority[] = ["none", "low", "medium", "high", "urgent"];

export default function TaskDetailScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const base = propertyId ? `/api/properties/${propertyId}` : null;

  const { data, loading, error, refetch } = useApi<ApiTask>(
    base && taskId ? `${base}/tasks/${taskId}` : null,
  );
  const { data: members } = useApi<ApiMember[]>(base ? `${base}/members` : null);

  // Local echo so a tap feels instant: optimistic field overrides layered on
  // top of the fetched row (the server response stays the source of truth —
  // refetch on settle replaces the base row underneath the overrides). The
  // API body and the row use different keys for assignee (`assigneeId` vs
  // `assignee_id`), so the local patch is passed separately from the body.
  const [overrides, setOverrides] = useState<Partial<ApiTask>>({});
  const task: ApiTask | null = data ? { ...data, ...overrides } : null;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const patch = async (
    body: Record<string, unknown>,
    local: Partial<ApiTask>,
  ) => {
    if (!base || !taskId || saving) return;
    const previous = overrides;
    setOverrides((o) => ({ ...o, ...local }));
    setSaving(true);
    setSaveError(null);
    try {
      await apiFetch(`${base}/tasks/${taskId}`, { method: "PATCH", body });
      refetch();
    } catch (err) {
      setOverrides(previous);
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !task) {
    return (
      <>
        <Stack.Screen options={{ title: "Task" }} />
        <Loading />
      </>
    );
  }
  if (error || !task) {
    return (
      <>
        <Stack.Screen options={{ title: "Task" }} />
        <ErrorState message={error ?? "Task not found"} onRetry={refetch} />
      </>
    );
  }

  const assignee = members?.find((m) => m.id === task.assignee_id) ?? null;
  const due = relativeDay(task.due_at);

  return (
    <>
      <Stack.Screen options={{ title: "Task" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>{task.title}</Text>

        {task.description ? (
          <Text style={styles.description}>{task.description}</Text>
        ) : null}

        {due ? (
          <Text style={styles.due}>
            Due {due.toLowerCase()}
            {task.status !== "done" && new Date(task.due_at!) < new Date()
              ? " · overdue"
              : ""}
          </Text>
        ) : null}

        {task.status !== "done" ? (
          <Pressable
            style={styles.complete}
            onPress={() => patch({ status: "done" }, { status: "done" })}
            disabled={saving}
          >
            <Text style={styles.completeText}>Mark complete</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.reopen}
            onPress={() => patch({ status: "todo" }, { status: "todo" })}
            disabled={saving}
          >
            <Text style={styles.reopenText}>Reopen</Text>
          </Pressable>
        )}

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

        {/* AI triage suggestions (RecommendationCard) — accepting applies the
            field server-side, then the row refetches underneath. */}
        {propertyId && taskId ? (
          <TriageSuggestions
            propertyId={propertyId}
            taskId={taskId}
            onApplied={refetch}
          />
        ) : null}

        <Section title="Status">
          <View style={styles.options}>
            {STATUSES.map((s) => (
              <Option
                key={s}
                label={STATUS_LABEL[s]}
                color={STATUS_COLOR[s]}
                selected={task.status === s}
                onPress={() => patch({ status: s }, { status: s })}
              />
            ))}
          </View>
        </Section>

        <Section title="Priority">
          <View style={styles.options}>
            {PRIORITIES.map((p) => (
              <Option
                key={p}
                label={PRIORITY_LABEL[p]}
                color={PRIORITY_COLOR[p]}
                selected={task.priority === p}
                onPress={() => patch({ priority: p }, { priority: p })}
              />
            ))}
          </View>
        </Section>

        <Section title={`Assignee${assignee ? "" : " — unassigned"}`}>
          <View style={styles.options}>
            <Option
              label="Unassigned"
              color="#6b7280"
              selected={!task.assignee_id}
              onPress={() => patch({ assigneeId: null }, { assignee_id: null })}
            />
            {(members ?? []).map((m) => (
              <Option
                key={m.id}
                label={m.name ?? m.email ?? m.id.slice(0, 8)}
                color="#2563eb"
                selected={task.assignee_id === m.id}
                onPress={() => patch({ assigneeId: m.id }, { assignee_id: m.id })}
              />
            ))}
          </View>
        </Section>

        {saving ? (
          <View style={styles.savingRow}>
            <AiPixelGrid />
            <AiShimmerLabel style={styles.savingText}>Saving…</AiShimmerLabel>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Option({
  label,
  color,
  selected,
  onPress,
}: {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.option,
        selected && { backgroundColor: color, borderColor: color },
      ]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  title: { fontSize: 22, fontWeight: "700" },
  description: { fontSize: 16, color: "#374151", lineHeight: 23 },
  due: { fontSize: 14, color: "#6b7280" },
  complete: {
    backgroundColor: "#16a34a",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  completeText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  reopen: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  reopenText: { color: "#374151", fontSize: 16, fontWeight: "600" },
  error: { color: "#dc2626", fontSize: 14 },
  section: { gap: 8, marginTop: 6 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  optionText: { fontSize: 14, color: "#374151", fontWeight: "500" },
  optionTextSelected: { color: "#ffffff" },
  savingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  savingText: { fontSize: 14, color: "#6b7280" },
});
