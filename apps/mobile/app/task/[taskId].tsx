import { TaskChecklists } from "../../components/TaskChecklists";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ActivityItem } from "../../components/ActivityFeed";
import { AiPixelGrid, AiShimmerLabel } from "../../components/AiLoader";
import { TriageSuggestions } from "../../components/TriageSuggestions";
import { TaskAiSheet } from "../../components/TaskAiSheet";
import {
  ErrorState,
  Loading,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  relativeDay,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { usePropertyContext } from "../../contexts/PropertyContext";
import { useActivityLog, useActivityLookup } from "../../lib/activity";
import {
  apiFetch,
  useApi,
  type ApiMember,
  type ApiTask,
  type TaskPriority,
  type TaskStatus,
  taskAssigneeIds,
} from "../../lib/api";
import { useCatalogues } from "../../lib/catalogues";
import { ENTITY_HEX, isDone, useStatusCatalog } from "../../lib/statuses";
import { supabase } from "../../lib/supabase";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const PRIORITIES: TaskPriority[] = ["none", "low", "medium", "high", "urgent"];

type SubIssue = { id: string; title: string; status: TaskStatus };

export default function TaskDetailScreen() {
  const router = useRouter();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { session } = useAuth();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const base = propertyId ? `/api/properties/${propertyId}` : null;

  const { data, loading, error, refetch } = useApi<ApiTask>(
    base && taskId ? `${base}/tasks/${taskId}` : null,
  );
  const { data: members } = useApi<ApiMember[]>(base ? `${base}/members` : null);
  const catalogues = useCatalogues(propertyId);
  // The task's own pipeline (0114): the list's statuses, else the four
  // legacy ones while the catalog loads.
  const statusCatalog = useStatusCatalog(propertyId);

  // Field-change history (activity_log, migration 0106) — who moved,
  // reassigned or rescheduled this task. Comments stay on the web for now.
  const historyScope = useMemo(() => ({ kind: "task" as const, id: taskId ?? "" }), [taskId]);
  const { rows: history } = useActivityLog(propertyId, historyScope, 60);
  const lookup = useActivityLookup(session?.user.id, members, catalogues.projects, catalogues.spaces);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Sub-issues: tasks whose parent is this one. Plain RLS read (reference
  // data); creating one goes through the API so triage + notifications run.
  const [subIssues, setSubIssues] = useState<SubIssue[]>([]);
  const [newSub, setNewSub] = useState("");
  const [addingSub, setAddingSub] = useState(false);
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    void supabase
      .from("tasks")
      .select("id, title, status")
      .eq("parent_id", taskId)
      .order("position", { ascending: true })
      .then(({ data: rows }) => {
        if (!cancelled) setSubIssues((rows ?? []) as SubIssue[]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, data?.updated_at]);

  const [newLabel, setNewLabel] = useState("");
  const [dueOpen, setDueOpen] = useState(false);

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

  // Everyone on it (0115) — a tap toggles a person; the first is the primary.
  const assigneeIds = taskAssigneeIds(task);
  const setAssignees = (ids: string[]) =>
    patch({ assigneeIds: ids }, { assignee_ids: ids, assignee_id: ids[0] ?? null });
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
            {!isDone(task) && new Date(task.due_at!) < new Date()
              ? " · overdue"
              : ""}
          </Text>
        ) : null}

        {!isDone(task) ? (
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

        {propertyId && taskId ? <TaskAiSheet propertyId={propertyId} taskId={taskId} /> : null}

        <Section title="Due date">
          <DueDateField
            value={task.due_at}
            open={dueOpen}
            onOpen={() => setDueOpen(true)}
            onChange={(iso) => {
              setDueOpen(false);
              void patch({ dueAt: iso }, { due_at: iso });
            }}
          />
        </Section>

        <Section
          title="Status"
          trailing={
            task.list_id ? statusCatalog.listById.get(task.list_id)?.name : undefined
          }
        >
          <View style={styles.options}>
            {(() => {
              const pipeline = statusCatalog.statusesOfList(task.list_id);
              if (pipeline.length === 0) {
                return STATUSES.map((s) => (
                  <Option
                    key={s}
                    label={STATUS_LABEL[s]}
                    color={STATUS_COLOR[s]}
                    selected={task.status === s}
                    onPress={() => patch({ status: s }, { status: s })}
                  />
                ));
              }
              return pipeline.map((s) => (
                <Option
                  key={s.id}
                  label={s.name}
                  color={ENTITY_HEX[s.color] ?? STATUS_COLOR.todo}
                  selected={task.status_id ? task.status_id === s.id : task.status_name === s.name}
                  onPress={() =>
                    // The PATCH route accepts a status uuid (resolved against
                    // the list by the DB); echo the row locally.
                    patch(
                      { status: s.id },
                      {
                        status_id: s.id,
                        status_name: s.name,
                        status_category: s.category,
                        status_color: s.color,
                        status_blocked: s.is_blocked,
                        status:
                          s.category === "active"
                            ? s.is_blocked
                              ? "blocked"
                              : "in_progress"
                            : s.category === "done" || s.category === "closed"
                              ? "done"
                              : "todo",
                      },
                    )
                  }
                />
              ));
            })()}
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

        <Section
          title={
            assigneeIds.length === 0
              ? "Assignees — unassigned"
              : `Assignees · ${assigneeIds.length}`
          }
        >
          <View style={styles.options}>
            <Option
              label="Unassigned"
              color="#6b7280"
              selected={assigneeIds.length === 0}
              onPress={() => setAssignees([])}
            />
            {(members ?? []).map((m) => (
              <Option
                key={m.id}
                label={`${m.name ?? m.email ?? m.id.slice(0, 8)}${
                  assigneeIds.length > 1 && assigneeIds[0] === m.id ? " · primary" : ""
                }`}
                color="#2563eb"
                selected={assigneeIds.includes(m.id)}
                onPress={() =>
                  setAssignees(
                    assigneeIds.includes(m.id)
                      ? assigneeIds.filter((id) => id !== m.id)
                      : [...assigneeIds, m.id],
                  )
                }
              />
            ))}
          </View>
        </Section>

        <Section title="Labels">
          <View style={styles.options}>
            {(task.labels ?? []).map((l) => (
              <Pressable
                key={l}
                onPress={() => {
                  const next = (task.labels ?? []).filter((x) => x !== l);
                  void patch({ labels: next }, { labels: next });
                }}
                style={styles.labelChip}
                accessibilityLabel={`Remove label ${l}`}
              >
                <Text style={styles.labelText}>{l}</Text>
                <Ionicons name="close" size={14} color="#6b7280" />
              </Pressable>
            ))}
            <View style={styles.labelInputWrap}>
              <TextInput
                style={styles.labelInput}
                placeholder="Add label"
                placeholderTextColor="#9ca3af"
                value={newLabel}
                onChangeText={setNewLabel}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={() => {
                  const v = newLabel.trim();
                  if (!v) return;
                  const next = Array.from(new Set([...(task.labels ?? []), v]));
                  setNewLabel("");
                  void patch({ labels: next }, { labels: next });
                }}
              />
            </View>
          </View>
        </Section>

        {task.project_id ? (
          <Pressable
            onPress={() =>
              router.navigate({ pathname: "/project/[projectId]", params: { projectId: task.project_id! } })
            }
            style={styles.projectLink}
          >
            <Ionicons name="folder-open-outline" size={16} color="#374151" />
            <Text style={styles.projectLinkText}>
              {task.project_name ?? catalogues.projects.find((p) => p.id === task.project_id)?.name ?? "Project"}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ) : null}

        <Section title={`Sub-issues${subIssues.length ? ` · ${subIssues.filter((x) => x.status === "done").length}/${subIssues.length}` : ""}`}>
          {subIssues.map((si) => (
            <Pressable
              key={si.id}
              onPress={() => router.navigate({ pathname: "/task/[taskId]", params: { taskId: si.id } })}
              style={styles.subRow}
            >
              <Ionicons
                name={isDone(si) ? "checkmark-circle" : "ellipse-outline"}
                size={18}
                color={isDone(si) ? STATUS_COLOR.done : "#9ca3af"}
              />
              <Text style={[styles.subTitle, isDone(si) && styles.subDone]} numberOfLines={2}>
                {si.title}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
          <View style={styles.subRow}>
            <Ionicons name="add" size={18} color="#9ca3af" />
            <TextInput
              style={styles.subInput}
              placeholder="Add a sub-issue"
              placeholderTextColor="#9ca3af"
              value={newSub}
              onChangeText={setNewSub}
              editable={!addingSub}
              returnKeyType="done"
              onSubmitEditing={async () => {
                const title = newSub.trim();
                if (!title || !propertyId || addingSub) return;
                setAddingSub(true);
                try {
                  await apiFetch(`/api/properties/${propertyId}/tasks`, {
                    method: "POST",
                    body: { title, parentId: taskId, projectId: task.project_id, spaceId: task.space_id },
                  });
                  setNewSub("");
                  refetch();
                } catch (err) {
                  setSaveError(err instanceof Error ? err.message : String(err));
                } finally {
                  setAddingSub(false);
                }
              }}
            />
          </View>
        </Section>

        {propertyId && taskId ? (
          <TaskChecklists propertyId={propertyId} taskId={taskId} />
        ) : null}

        {(history ?? []).filter((r) => r.verb !== "created").length > 0 ? (
          <Section title="History">
            {(history ?? [])
              .filter((r) => r.verb !== "created")
              .slice(0, historyOpen ? undefined : 5)
              .map((r) => (
                <ActivityItem key={r.id} row={r} lookup={lookup} />
              ))}
            {(history ?? []).filter((r) => r.verb !== "created").length > 5 ? (
              <Pressable onPress={() => setHistoryOpen((v) => !v)} hitSlop={8}>
                <Text style={styles.more}>{historyOpen ? "Show less" : "Show all changes"}</Text>
              </Pressable>
            ) : null}
          </Section>
        ) : null}

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

/** Due date — native picker (inline on iOS, dialog on Android), with Clear. */
function DueDateField({
  value,
  open,
  onOpen,
  onChange,
}: {
  value: string | null;
  open: boolean;
  onOpen: () => void;
  onChange: (iso: string | null) => void;
}) {
  const current = value ? new Date(value) : new Date();
  const label = value
    ? new Date(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : "No due date";
  return (
    <View style={styles.dueRow}>
      {Platform.OS === "ios" ? (
        <DateTimePicker
          value={current}
          mode="date"
          onChange={(event, d) => {
            if (event.type === "set" && d) {
              const next = new Date(d);
              next.setHours(17, 0, 0, 0);
              onChange(next.toISOString());
            }
          }}
        />
      ) : (
        <>
          <Pressable style={styles.option} onPress={onOpen}>
            <Text style={styles.optionText}>{label}</Text>
          </Pressable>
          {open ? (
            <DateTimePicker
              value={current}
              mode="date"
              onChange={(event, d) => {
                if (event.type === "set" && d) {
                  const next = new Date(d);
                  next.setHours(17, 0, 0, 0);
                  onChange(next.toISOString());
                } else onChange(value);
              }}
            />
          ) : null}
        </>
      )}
      {value ? (
        <Pressable style={styles.option} onPress={() => onChange(null)} hitSlop={6}>
          <Text style={styles.optionText}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Section({
  title,
  trailing,
  children,
}: {
  title: string;
  /** Muted caption after the title (the task's list on the Status section). */
  trailing?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title}
        {trailing ? <Text style={styles.sectionTrailing}> · {trailing}</Text> : null}
      </Text>
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
  sectionTrailing: { fontWeight: "400", color: "#9ca3af", textTransform: "none" },
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
  dueRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  labelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  labelText: { fontSize: 13, fontWeight: "500", color: "#374151" },
  labelInputWrap: { minWidth: 110 },
  labelInput: { fontSize: 14, color: "#111827", paddingVertical: 7, paddingHorizontal: 4 },
  projectLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
  },
  projectLinkText: { flex: 1, fontSize: 15, fontWeight: "500", color: "#111827" },
  chevron: { fontSize: 18, color: "#9ca3af" },
  subRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  subTitle: { flex: 1, fontSize: 15, color: "#111827" },
  subDone: { color: "#9ca3af", textDecorationLine: "line-through" },
  subInput: { flex: 1, fontSize: 15, color: "#111827", paddingVertical: 2 },
  more: { fontSize: 13, color: "#6b7280", paddingVertical: 4 },
});
