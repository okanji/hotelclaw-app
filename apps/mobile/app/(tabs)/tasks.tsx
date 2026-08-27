import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { fadeUpEntering } from "../../components/AiLoader";
import { initialsFor, ScreenHeader } from "../../components/ScreenHeader";
import {
  CountBadge,
  EmptyState,
  ErrorState,
  Loading,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  Pill,
  Row,
  STATUS_COLOR,
  SheetSurface,
  relativeDay,
} from "../../components/ui";
import { TaskFilterSheet } from "../../components/TaskFilterSheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../contexts/AuthContext";
import { usePropertyContext } from "../../contexts/PropertyContext";
import {
  apiFetch,
  useApi,
  type ApiMember,
  type ApiTask,
  type TaskStatus,
} from "../../lib/api";
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

type TaskSection = {
  key: string;
  title: string;
  overdue?: boolean;
  /** Running item offset, so entrance stagger is global across sections. */
  startIndex: number;
  data: ApiTask[];
};

/** Group into scannable due-date sections (the filter sheet's bucket names),
 *  done tasks last. Within-section order is the filtered order, so the sort
 *  facet still applies. Day boundaries match web's `taskDueBuckets`. */
function sectionTasks(tasks: ApiTask[], now: number): TaskSection[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const day = 86_400_000;

  const buckets: Record<string, ApiTask[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    none: [],
    done: [],
  };
  for (const t of tasks) {
    if (t.status === "done") {
      buckets.done.push(t);
      continue;
    }
    const ts = t.due_at ? Date.parse(t.due_at) : NaN;
    if (Number.isNaN(ts)) buckets.none.push(t);
    else if (ts < t0) buckets.overdue.push(t);
    else if (ts < t0 + day) buckets.today.push(t);
    else if (ts < t0 + 2 * day) buckets.tomorrow.push(t);
    else if (ts < t0 + 7 * day) buckets.week.push(t);
    else buckets.later.push(t);
  }

  const order: { key: string; title: string; overdue?: boolean }[] = [
    { key: "overdue", title: "Overdue", overdue: true },
    { key: "today", title: "Today" },
    { key: "tomorrow", title: "Tomorrow" },
    { key: "week", title: "This week" },
    { key: "later", title: "Later" },
    { key: "none", title: "No due date" },
    { key: "done", title: "Done" },
  ];
  const sections: TaskSection[] = [];
  let offset = 0;
  for (const o of order) {
    const data = buckets[o.key];
    if (data.length === 0) continue;
    sections.push({ ...o, startIndex: offset, data });
    offset += data.length;
  }
  // A lone "No due date" header over the whole list is noise — drop it.
  if (sections.length === 1 && sections[0].key === "none") {
    sections[0].title = "";
  }
  return sections;
}

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
  // Per-scope counts for the chip badges (FilterTable pattern) — computed
  // from the unfiltered rows so a facet doesn't change what each scope holds.
  const scopeCounts = useMemo(() => {
    const all = data ?? [];
    const open = all.filter((t) => t.status !== "done");
    return {
      mine: open.filter((t) => t.assignee_id === userId).length,
      open: open.length,
      all: all.length,
    };
  }, [data, userId]);
  const sections = useMemo(() => sectionTasks(tasks, now), [tasks, now]);
  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.name) map.set(m.id, m.name);
    return map;
  }, [members]);

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
            style={[
              styles.chip,
              styles.chipWithCount,
              scope === s.value && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                scope === s.value && styles.chipTextActive,
              ]}
            >
              {s.label}
            </Text>
            {data ? (
              <CountBadge
                count={scopeCounts[s.value]}
                tone={scope === s.value ? "onDark" : "default"}
              />
            ) : null}
          </Pressable>
        ))}
        <Pressable
          onPress={() => setFiltering(true)}
          style={[
            styles.chip,
            styles.chipWithCount,
            facetCount > 0 && styles.chipActive,
          ]}
        >
          <Text
            style={[styles.chipText, facetCount > 0 && styles.chipTextActive]}
          >
            Filters
          </Text>
          {facetCount > 0 ? (
            <CountBadge count={facetCount} tone="onDark" />
          ) : null}
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
          icon={facetCount > 0 || filters.search ? "search" : "checkmark-done"}
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
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          refreshing={loading}
          onRefresh={refetch}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionTitle,
                    section.overdue && styles.sectionTitleOverdue,
                  ]}
                >
                  {section.title}
                </Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{section.data.length}</Text>
                </View>
              </View>
            ) : null
          }
          renderItem={({ item, index, section }) => (
            <TaskRow
              task={item}
              index={section.startIndex + index}
              assigneeName={
                item.assignee_id
                  ? memberNames.get(item.assignee_id)
                  : undefined
              }
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

/** Leading status glyph — status reads at a glance without a pill shouting on
 *  every row (the section + glyph carry it; pills are saved for priority). */
function StatusGlyph({ status }: { status: TaskStatus }) {
  if (status === "done") {
    return (
      <Ionicons name="checkmark-circle" size={22} color={STATUS_COLOR.done} />
    );
  }
  if (status === "blocked") {
    return (
      <Ionicons name="remove-circle" size={22} color={STATUS_COLOR.blocked} />
    );
  }
  const inProgress = status === "in_progress";
  return (
    <View
      style={[
        styles.glyphRing,
        inProgress && { borderColor: STATUS_COLOR.in_progress },
      ]}
    >
      {inProgress ? <View style={styles.glyphDot} /> : null}
    </View>
  );
}

function TaskRow({
  task,
  index,
  assigneeName,
  onPress,
}: {
  task: ApiTask;
  index: number;
  assigneeName?: string;
  onPress: () => void;
}) {
  const due = relativeDay(task.due_at);
  // Inside the Today/Tomorrow sections the due text just repeats the section
  // title — drop it there; elsewhere ("3 days ago", "In 12 days") it earns
  // its place.
  const dueText = due === "Today" || due === "Tomorrow" ? null : due;
  const overdue =
    !!task.due_at && new Date(task.due_at) < new Date() && task.status !== "done";
  const urgent = task.priority === "urgent" || task.priority === "high";
  const hasMeta = !!dueText || urgent || !!task.project_name;

  return (
    // Staggered fade-up on first paint (capped, so rows past the fold and
    // scroll-mounted rows enter without a crawl).
    <Animated.View entering={fadeUpEntering(index)}>
      <Row onPress={onPress}>
        <View style={styles.rowInner}>
          <View style={styles.glyphSlot}>
            <StatusGlyph status={task.status} />
          </View>
          <View style={styles.rowMain}>
            <Text
              style={[
                styles.taskTitle,
                task.status === "done" && styles.taskDone,
              ]}
              numberOfLines={2}
            >
              {task.title}
            </Text>
            {hasMeta ? (
              <View style={styles.meta}>
                {dueText ? (
                  <Text style={[styles.due, overdue && styles.overdue]}>
                    {dueText}
                  </Text>
                ) : null}
                {urgent ? (
                  <Pill
                    label={PRIORITY_LABEL[task.priority]}
                    color={PRIORITY_COLOR[task.priority]}
                  />
                ) : null}
                {task.project_name ? (
                  <Text style={styles.project} numberOfLines={1}>
                    {task.project_name}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {assigneeName ? (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsFor(assigneeName)}</Text>
            </View>
          ) : null}
        </View>
      </Row>
    </Animated.View>
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
  chipWithCount: { flexDirection: "row", alignItems: "center", gap: 6 },
  chipActive: { backgroundColor: "#111827" },
  chipText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  chipTextActive: { color: "#ffffff" },
  listContent: { paddingBottom: 32 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
    backgroundColor: "#ffffff",
  },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "#6b7280" },
  sectionTitleOverdue: { color: "#dc2626" },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 6,
    paddingHorizontal: 6,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
    fontVariant: ["tabular-nums"],
  },
  rowInner: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  // Sized to the title's first line so the glyph optically centers on it.
  glyphSlot: {
    width: 22,
    height: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  glyphDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: STATUS_COLOR.in_progress,
  },
  rowMain: { flex: 1 },
  taskTitle: { fontSize: 16, fontWeight: "500", lineHeight: 21 },
  taskDone: { color: "#9ca3af", textDecorationLine: "line-through" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  due: { fontSize: 13, color: "#6b7280", fontVariant: ["tabular-nums"] },
  overdue: { color: "#dc2626", fontWeight: "600" },
  project: { fontSize: 13, color: "#9ca3af", flexShrink: 1 },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -1,
  },
  avatarText: { fontSize: 10, fontWeight: "600", color: "#4b5563" },
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
