import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
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
import { initialsFor } from "../../components/ScreenHeader";
import {
  EmptyState,
  ErrorState,
  Loading,
  PRIORITY_COLOR,
  Pill,
  STATUS_COLOR,
  STATUS_LABEL,
  relativeDay,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { usePropertyContext } from "../../contexts/PropertyContext";
import { useActivityLog, useActivityLookup } from "../../lib/activity";
import { useApi, type ApiMember, type TaskPriority, type TaskStatus } from "../../lib/api";
import { useCatalogues } from "../../lib/catalogues";
import {
  ENTITY_COLOR,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  daysUntil,
  formatDateOnly,
  useProject,
  type Milestone,
} from "../../lib/projects";

type Tab = "overview" | "tasks" | "activity";

function toDateOnly(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One project: overview (status, lead, dates, progress, milestones with
 * reach/unreach + add), its tasks grouped by status, and who-did-what.
 * The phone twin of `apps/web/components/projects/project-detail.tsx`.
 */
export default function ProjectScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { session } = useAuth();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const { project, tasks, milestones, error, reload, toggleMilestone, addMilestone } =
    useProject(projectId);
  const { data: members } = useApi<ApiMember[]>(
    propertyId ? `/api/properties/${propertyId}/members` : null,
  );
  const catalogues = useCatalogues(propertyId);
  const lookup = useActivityLookup(session?.user.id, members, catalogues.projects, catalogues.spaces);
  const { rows: activity } = useActivityLog(
    propertyId,
    useMemo(() => ({ kind: "project" as const, id: projectId ?? "" }), [projectId]),
    80,
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [adding, setAdding] = useState(false);
  const [msName, setMsName] = useState("");
  const [msDate, setMsDate] = useState(() => new Date());
  const [actionError, setActionError] = useState<string | null>(null);

  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const lead = project?.lead_user_id ? members?.find((m) => m.id === project.lead_user_id) : undefined;
  const reached = milestones.filter((m) => m.completed_at).length;

  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (project === undefined) return <Loading label="Loading project…" />;
  if (project === null) return <EmptyState title="Project not found" />;

  const submitMilestone = async () => {
    const name = msName.trim();
    if (!name || !propertyId) return;
    const err = await addMilestone(propertyId, name, toDateOnly(msDate));
    if (err) setActionError(err);
    else {
      setMsName("");
      setAdding(false);
    }
  };

  const byStatus: Record<TaskStatus, typeof tasks> = { todo: [], in_progress: [], blocked: [], done: [] };
  for (const t of tasks) byStatus[t.status].push(t);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: project.name || "Project" }} />
      <View style={styles.tabs}>
        {(
          [
            { id: "overview", label: "Overview" },
            { id: "tasks", label: `Tasks · ${tasks.length}` },
            { id: "activity", label: "Activity" },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === "overview" ? (
          <>
            <View style={styles.headerRow}>
              <View style={[styles.dot, { backgroundColor: ENTITY_COLOR[project.color] ?? ENTITY_COLOR.slate }]} />
              <Text style={styles.title}>
                {project.icon ? `${project.icon} ` : ""}
                {project.name || "Untitled project"}
              </Text>
            </View>
            {project.description ? <Text style={styles.description}>{project.description}</Text> : null}

            <View style={styles.facts}>
              <Fact label="Status">
                <Pill label={PROJECT_STATUS_LABEL[project.status]} color={PROJECT_STATUS_COLOR[project.status]} />
              </Fact>
              <Fact label="Lead">
                {lead ? (
                  <View style={styles.leadRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initialsFor(lead.name ?? lead.email ?? "?")}</Text>
                    </View>
                    <Text style={styles.factValue}>{lead.name ?? lead.email}</Text>
                  </View>
                ) : (
                  <Text style={styles.factMuted}>No lead</Text>
                )}
              </Fact>
              <Fact label="Dates">
                <Text style={styles.factValue}>
                  {formatDateOnly(project.start_date) ?? "—"} → {formatDateOnly(project.target_date) ?? "—"}
                </Text>
              </Fact>
            </View>

            <Section title="Progress" trailing={`${done} of ${tasks.length} done`}>
              <View style={styles.progressRow}>
                <Text style={styles.pctBig}>{pct}%</Text>
                <View style={styles.stack}>
                  {(["done", "in_progress", "blocked", "todo"] as TaskStatus[]).map((s) =>
                    byStatus[s].length ? (
                      <View
                        key={s}
                        style={{ flex: byStatus[s].length, backgroundColor: STATUS_COLOR[s], height: 8 }}
                      />
                    ) : null,
                  )}
                </View>
              </View>
            </Section>

            <Section
              title="Milestones"
              trailing={milestones.length ? `${reached}/${milestones.length} reached` : undefined}
              action={
                !adding ? (
                  <Pressable onPress={() => setAdding(true)} hitSlop={8}>
                    <Ionicons name="add" size={22} color="#111827" />
                  </Pressable>
                ) : null
              }
            >
              {milestones.length === 0 && !adding ? (
                <Text style={styles.factMuted}>No milestones yet — add the dates this project is judged against.</Text>
              ) : null}
              {milestones.map((m) => (
                <MilestoneRow
                  key={m.id}
                  milestone={m}
                  onToggle={async () => {
                    const err = await toggleMilestone(m);
                    if (err) setActionError(err);
                  }}
                />
              ))}
              {adding ? (
                <View style={styles.addBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="Milestone name"
                    placeholderTextColor="#9ca3af"
                    value={msName}
                    onChangeText={setMsName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => void submitMilestone()}
                  />
                  <DatePickerField value={msDate} onChange={setMsDate} />
                  <View style={styles.addActions}>
                    <Pressable onPress={() => { setAdding(false); setMsName(""); }} hitSlop={8}>
                      <Text style={styles.cancel}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={() => void submitMilestone()} disabled={!msName.trim()} hitSlop={8}>
                      <Text style={[styles.save, !msName.trim() && styles.disabled]}>Add</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
            </Section>

            <Section title="Recent activity">
              {(activity ?? []).length === 0 ? (
                <Text style={styles.factMuted}>Nothing yet.</Text>
              ) : (
                (activity ?? []).slice(0, 6).map((r) => <ActivityItem key={r.id} row={r} lookup={lookup} />)
              )}
            </Section>
          </>
        ) : tab === "tasks" ? (
          tasks.length === 0 ? (
            <EmptyState icon="checkmark-done" title="No tasks in this project" body="Add tasks to it from the task filters on the web app." />
          ) : (
            (["todo", "in_progress", "blocked", "done"] as TaskStatus[]).map((s) =>
              byStatus[s].length ? (
                <Section key={s} title={STATUS_LABEL[s]} trailing={String(byStatus[s].length)}>
                  {byStatus[s].map((t) => {
                    const due = relativeDay(t.due_at);
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => router.navigate({ pathname: "/task/[taskId]", params: { taskId: t.id } })}
                        style={({ pressed }) => [styles.taskRow, pressed && styles.pressed]}
                      >
                        <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[t.status] }]} />
                        <Text style={[styles.taskTitle, t.status === "done" && styles.taskDone]} numberOfLines={2}>
                          {t.title}
                        </Text>
                        {t.priority === "urgent" || t.priority === "high" ? (
                          <View style={[styles.prioDot, { backgroundColor: PRIORITY_COLOR[t.priority as TaskPriority] }]} />
                        ) : null}
                        {due ? <Text style={styles.due}>{due}</Text> : null}
                      </Pressable>
                    );
                  })}
                </Section>
              ) : null,
            )
          )
        ) : (activity ?? []).length === 0 ? (
          <EmptyState icon="pulse-outline" title="No activity yet" body="Changes to this project's tasks and milestones will appear here, with who made them." />
        ) : (
          (activity ?? []).map((r) => <ActivityItem key={r.id} row={r} lookup={lookup} />)
        )}
      </ScrollView>
    </View>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <View style={styles.factBody}>{children}</View>
    </View>
  );
}

function Section({
  title,
  trailing,
  action,
  children,
}: {
  title: string;
  trailing?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.spacer} />
        {trailing ? <Text style={styles.sectionTrailing}>{trailing}</Text> : null}
        {action}
      </View>
      {children}
    </View>
  );
}

function MilestoneRow({ milestone, onToggle }: { milestone: Milestone; onToggle: () => void }) {
  const done = Boolean(milestone.completed_at);
  const n = daysUntil(milestone.due_date);
  const late = !done && n < 0;
  const rel = done ? "Reached" : n === 0 ? "today" : n === 1 ? "tomorrow" : n > 0 ? `in ${n} days` : `${-n} days ago`;
  return (
    <Pressable onPress={onToggle} style={({ pressed }) => [styles.msRow, pressed && styles.pressed]}>
      <Ionicons
        name={done ? "checkmark-circle" : late ? "alert-circle-outline" : "ellipse-outline"}
        size={20}
        color={done ? "#16a34a" : late ? "#d97706" : "#9ca3af"}
      />
      <Text style={[styles.msName, done && styles.taskDone]} numberOfLines={2}>
        {milestone.name}
      </Text>
      <View style={styles.msRight}>
        <Text style={styles.msDate}>{formatDateOnly(milestone.due_date)}</Text>
        <Text style={[styles.msRel, done && { color: "#16a34a" }, late && { color: "#d97706" }]}>{rel}</Text>
      </View>
    </Pressable>
  );
}

function DatePickerField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  if (Platform.OS === "ios") {
    return <DateTimePicker value={value} mode="date" onChange={(_, d) => d && onChange(d)} />;
  }
  return (
    <>
      <Pressable style={styles.androidChip} onPress={() => setOpen(true)}>
        <Text style={styles.androidChipText}>
          {value.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={value}
          mode="date"
          onChange={(event, d) => {
            setOpen(false);
            if (event.type === "set" && d) onChange(d);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "#f3f4f6" },
  tabActive: { backgroundColor: "#111827" },
  tabText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  tabTextActive: { color: "#ffffff" },
  content: { padding: 16, paddingBottom: 48, gap: 18 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { flex: 1, fontSize: 22, fontWeight: "700", color: "#111827" },
  description: { fontSize: 15, color: "#374151", lineHeight: 22 },
  facts: { gap: 10 },
  fact: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 },
  factLabel: { width: 64, fontSize: 13, color: "#6b7280" },
  factBody: { flex: 1, flexDirection: "row", alignItems: "center" },
  factValue: { fontSize: 15, color: "#111827" },
  factMuted: { fontSize: 14, color: "#9ca3af" },
  leadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 9, fontWeight: "600", color: "#4b5563" },
  section: { gap: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 },
  sectionTrailing: { fontSize: 13, color: "#6b7280", fontVariant: ["tabular-nums"] },
  spacer: { flex: 1 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  pctBig: { fontSize: 28, fontWeight: "700", color: "#111827", fontVariant: ["tabular-nums"] },
  stack: { flex: 1, flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#e5e7eb" },
  msRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  msName: { flex: 1, fontSize: 15, fontWeight: "500", color: "#111827" },
  msRight: { alignItems: "flex-end" },
  msDate: { fontSize: 13, color: "#374151", fontVariant: ["tabular-nums"] },
  msRel: { fontSize: 11, color: "#9ca3af" },
  addBox: { gap: 10, paddingVertical: 8 },
  input: { fontSize: 16, color: "#111827", backgroundColor: "#f3f4f6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  addActions: { flexDirection: "row", justifyContent: "flex-end", gap: 20 },
  cancel: { fontSize: 15, color: "#6b7280" },
  save: { fontSize: 15, fontWeight: "600", color: "#2563eb" },
  disabled: { color: "#9ca3af" },
  error: { color: "#dc2626", fontSize: 13 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  pressed: { opacity: 0.6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  prioDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { flex: 1, fontSize: 15, color: "#111827" },
  taskDone: { color: "#9ca3af", textDecorationLine: "line-through" },
  due: { fontSize: 12, color: "#6b7280", fontVariant: ["tabular-nums"] },
  androidChip: { backgroundColor: "#f3f4f6", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  androidChipText: { fontSize: 15, color: "#111827", fontWeight: "500" },
});
