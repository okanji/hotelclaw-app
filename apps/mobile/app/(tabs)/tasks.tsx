import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { initialsFor, ScreenHeader } from "../../components/ScreenHeader";
import {
  EmptyState,
  ErrorState,
  Loading,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  Pill,
  Row,
  STATUS_COLOR,
  STATUS_LABEL,
  SheetSurface,
  relativeDay,
} from "../../components/ui";
import { TaskFilterSheet } from "../../components/TaskFilterSheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../contexts/AuthContext";
import { usePropertyContext } from "../../contexts/PropertyContext";
import { apiFetch, useApi, type ApiMember, type ApiTask } from "../../lib/api";
import { useCatalogues } from "../../lib/catalogues";
import { useTaskListState, type Scope } from "../../lib/task-filter-store";
import { useDayStart } from "../../lib/use-day-start";
import {
  activeFacetCount,
  applyTaskFilters,
  labelOptions,
} from "../../lib/task-filters";

/** Quick scopes sit above the full facet sheet — the two things you want on a
 *  phone without opening anything. */
const SCOPES: { value: Scope; label: string }[] = [
  { value: "mine", label: "My tasks" },
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
];

export default function TasksTab() {
  const router = useRouter();
  const { session } = useAuth();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const userId = session?.user.id;

  // Held in a module store, not useState, so returning from a task detail lands
  // on the same filtered list you left.
  const { scope, filters, setScope, setFilters } = useTaskListState();
  const [composing, setComposing] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Due-date buckets need a clock; useDayStart reads it the pure way.
  const now = useDayStart();

  const { data, loading, error, refetch } = useApi<ApiTask[]>(
    propertyId ? `/api/properties/${propertyId}/tasks` : null,
  );
  const { data: members } = useApi<ApiMember[]>(
    propertyId ? `/api/properties/${propertyId}/members` : null,
  );
  const catalogues = useCatalogues(propertyId);

  const tasks = useMemo(() => {
    let all = data ?? [];
    if (scope === "mine") {
      all = all.filter((t) => t.assignee_id === userId && t.status !== "done");
    } else if (scope === "open") {
      all = all.filter((t) => t.status !== "done");
    }
    return applyTaskFilters(all, filters, now, catalogues.fieldValues);
  }, [data, scope, userId, filters, now, catalogues.fieldValues]);

  const facetCount = activeFacetCount(filters);
  const labels = useMemo(() => labelOptions(data ?? []), [data]);

  const name = activeProperty?.property.name;

  return (
    <View style={styles.container}>
      {searchOpen ? (
        <TaskSearchBar
          value={filters.search}
          onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
          onClose={() => {
            setSearchOpen(false);
            setFilters((f) => ({ ...f, search: "" }));
          }}
        />
      ) : (
      <ScreenHeader
        title="Tasks"
        badgeLabel={name ? initialsFor(name) : undefined}
        accessory={
          <View style={styles.iconPill}>
            <Pressable
              onPress={() => setSearchOpen(true)}
              hitSlop={6}
              style={styles.iconButton}
              accessibilityLabel="Search tasks"
            >
              <Ionicons name="search" size={20} color="#111827" />
            </Pressable>
            {propertyId ? (
              <Pressable
                onPress={() => setComposing(true)}
                hitSlop={6}
                style={styles.iconButton}
                accessibilityLabel="New task"
              >
                <Ionicons name="add" size={24} color="#111827" />
              </Pressable>
            ) : null}
          </View>
        }
      />
      )}

      <View style={styles.filters}>
        {SCOPES.map((s) => (
          <Pressable
            key={s.value}
            onPress={() => setScope(s.value)}
            style={[styles.chip, scope === s.value && styles.chipActive]}
          >
            <Text
              style={[
                styles.chipText,
                scope === s.value && styles.chipTextActive,
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setFiltering(true)}
          style={[styles.chip, facetCount > 0 && styles.chipActive]}
        >
          <Text
            style={[styles.chipText, facetCount > 0 && styles.chipTextActive]}
          >
            {facetCount > 0 ? `Filters · ${facetCount}` : "Filters"}
          </Text>
        </Pressable>
      </View>

      {!propertyId ? (
        <EmptyState title="No property selected" />
      ) : loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : tasks.length === 0 ? (
        <EmptyState
          title={
            facetCount > 0 || filters.search
              ? "No matching tasks"
              : scope === "mine"
                ? "Nothing assigned to you"
                : "No tasks"
          }
          body={
            facetCount > 0 || filters.search
              ? "Try clearing a filter."
              : scope === "mine"
                ? "Tasks assigned to you show up here."
                : undefined
          }
        />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
          refreshing={loading}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              onPress={() =>
                // navigate (not push) so a double-tap can't stack the screen
                router.navigate({
                  pathname: "/task/[taskId]",
                  params: { taskId: item.id },
                })
              }
            />
          )}
        />
      )}

      <TaskFilterSheet
        visible={filtering}
        filters={filters}
        members={members ?? []}
        labels={labels}
        catalogues={catalogues}
        onChange={setFilters}
        onClose={() => setFiltering(false)}
      />

      <NewTaskSheet
        visible={composing}
        propertyId={propertyId}
        onClose={() => setComposing(false)}
        onCreated={() => {
          setComposing(false);
          refetch();
        }}
      />
    </View>
  );
}

function TaskSearchBar({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.searchBar, { paddingTop: insets.top + 6 }]}>
      <View style={styles.searchField}>
        <Ionicons name="search" size={18} color="#9ca3af" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search tasks"
          placeholderTextColor="#9ca3af"
          value={value}
          onChangeText={onChange}
          autoFocus
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <Pressable onPress={onClose} hitSlop={10}>
        <Ionicons name="close-circle" size={26} color="#9ca3af" />
      </Pressable>
    </View>
  );
}

function TaskRow({ task, onPress }: { task: ApiTask; onPress: () => void }) {
  const due = relativeDay(task.due_at);
  const overdue =
    !!task.due_at && new Date(task.due_at) < new Date() && task.status !== "done";

  return (
    <Row onPress={onPress}>
      <Text
        style={[styles.taskTitle, task.status === "done" && styles.taskDone]}
        numberOfLines={2}
      >
        {task.title}
      </Text>
      <View style={styles.meta}>
        <Pill
          label={STATUS_LABEL[task.status]}
          color={STATUS_COLOR[task.status]}
        />
        {task.priority !== "none" ? (
          <Pill
            label={PRIORITY_LABEL[task.priority]}
            color={PRIORITY_COLOR[task.priority]}
          />
        ) : null}
        {due ? (
          <Text style={[styles.due, overdue && styles.overdue]}>{due}</Text>
        ) : null}
      </View>
    </Row>
  );
}

function NewTaskSheet({
  visible,
  propertyId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  propertyId: string | undefined;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !propertyId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/properties/${propertyId}/tasks`, {
        method: "POST",
        body: { title: title.trim() },
      });
      setTitle("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SheetSurface style={styles.sheetPad}>
        <View style={styles.sheetBar}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.sheetCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>New task</Text>
          <Pressable onPress={submit} hitSlop={10} disabled={!title.trim()}>
            <Text
              style={[styles.sheetSave, !title.trim() && styles.sheetDisabled]}
            >
              {saving ? "Saving…" : "Add"}
            </Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          placeholder="What needs doing?"
          placeholderTextColor="#9ca3af"
          value={title}
          onChangeText={setTitle}
          autoFocus
          multiline
          onSubmitEditing={submit}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {/* Team, assignee and priority are left to the triage bot — it fills
            bare tasks in the background, the same as a task created on web. */}
        <Text style={styles.hint}>
          Added to your home team. Assignee and priority get suggested
          automatically.
        </Text>
      </SheetSurface>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  iconPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#f3f4f6",
    borderRadius: 999,
    paddingHorizontal: 4,
  },
  iconButton: { paddingHorizontal: 8, paddingVertical: 7 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  searchField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 16, color: "#111827" },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  chipActive: { backgroundColor: "#111827" },
  chipText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  chipTextActive: { color: "#ffffff" },
  taskTitle: { fontSize: 16, fontWeight: "500" },
  taskDone: { color: "#9ca3af", textDecorationLine: "line-through" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  due: { fontSize: 13, color: "#6b7280" },
  overdue: { color: "#dc2626", fontWeight: "600" },
  sheetPad: { padding: 16, gap: 12 },
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 16, fontWeight: "600" },
  sheetCancel: { fontSize: 16, color: "#6b7280" },
  sheetSave: { fontSize: 16, fontWeight: "600", color: "#2563eb" },
  sheetDisabled: { color: "#9ca3af" },
  input: {
    fontSize: 17,
    minHeight: 80,
    textAlignVertical: "top",
    color: "#111827",
  },
  error: { color: "#dc2626", fontSize: 14 },
  hint: { fontSize: 13, color: "#6b7280" },
});
