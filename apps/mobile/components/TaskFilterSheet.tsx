import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  SheetSurface,
} from "./ui";
import type {
  ApiMember,
  RecordSource,
  TaskPriority,
  TaskStatus,
} from "../lib/api";
import type { Catalogues } from "../lib/catalogues";
import {
  EMPTY_TASK_FILTERS,
  FIELD_EMPTY,
  FIELD_SET,
  NONE,
  UNASSIGNED,
  activeFacetCount,
  type DueBucket,
  type SortBy,
  type TaskFilters,
} from "../lib/task-filters";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low", "none"];
const DUE: { value: DueBucket; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "none", label: "No due date" },
];
const SOURCES: { value: RecordSource; label: string }[] = [
  { value: "user", label: "Created by a person" },
  { value: "ai", label: "Created by AI" },
  { value: "workflow", label: "Created by a workflow" },
];
const SORTS: { value: SortBy; label: string }[] = [
  { value: "manual", label: "Manual order" },
  { value: "priority", label: "Priority" },
  { value: "due_at", label: "Due date" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function TaskFilterSheet({
  visible,
  filters,
  members,
  labels,
  catalogues,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: TaskFilters;
  members: ApiMember[];
  labels: string[];
  catalogues: Catalogues;
  onChange: (next: TaskFilters) => void;
  onClose: () => void;
}) {
  const count = activeFacetCount(filters);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SheetSurface>
        <View style={styles.bar}>
          <Pressable
            onPress={() => onChange({ ...EMPTY_TASK_FILTERS, search: filters.search })}
            hitSlop={10}
            disabled={count === 0}
          >
            <Text style={[styles.clear, count === 0 && styles.disabled]}>
              Clear
            </Text>
          </Pressable>
          <Text style={styles.title}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Facet title="Status">
            {STATUSES.map((s) => (
              <Chip
                key={s}
                label={STATUS_LABEL[s]}
                color={STATUS_COLOR[s]}
                selected={filters.statuses.includes(s)}
                onPress={() =>
                  onChange({ ...filters, statuses: toggle(filters.statuses, s) })
                }
              />
            ))}
          </Facet>

          <Facet title="Priority">
            {PRIORITIES.map((p) => (
              <Chip
                key={p}
                label={PRIORITY_LABEL[p]}
                color={PRIORITY_COLOR[p]}
                selected={filters.priorities.includes(p)}
                onPress={() =>
                  onChange({
                    ...filters,
                    priorities: toggle(filters.priorities, p),
                  })
                }
              />
            ))}
          </Facet>

          <Facet title="Due">
            {DUE.map((d) => (
              <Chip
                key={d.value}
                label={d.label}
                color={d.value === "overdue" ? "#dc2626" : "#2563eb"}
                selected={filters.due.includes(d.value)}
                onPress={() =>
                  onChange({ ...filters, due: toggle(filters.due, d.value) })
                }
              />
            ))}
          </Facet>

          <Facet title="Assignee">
            <Chip
              label="Unassigned"
              color="#6b7280"
              selected={filters.assignees.includes(UNASSIGNED)}
              onPress={() =>
                onChange({
                  ...filters,
                  assignees: toggle(filters.assignees, UNASSIGNED),
                })
              }
            />
            {members.map((m) => (
              <Chip
                key={m.id}
                label={m.name ?? m.email ?? m.id.slice(0, 8)}
                color="#2563eb"
                selected={filters.assignees.includes(m.id)}
                onPress={() =>
                  onChange({
                    ...filters,
                    assignees: toggle(filters.assignees, m.id),
                  })
                }
              />
            ))}
          </Facet>

          {labels.length > 0 ? (
            <Facet title="Labels">
              {labels.map((l) => (
                <Chip
                  key={l}
                  label={l}
                  color="#7c3aed"
                  selected={filters.labels.includes(l)}
                  onPress={() =>
                    onChange({ ...filters, labels: toggle(filters.labels, l) })
                  }
                />
              ))}
            </Facet>
          ) : null}

          <Facet title="Created by">
            {members.map((m) => (
              <Chip
                key={m.id}
                label={m.name ?? m.email ?? m.id.slice(0, 8)}
                color="#0f766e"
                selected={filters.creators.includes(m.id)}
                onPress={() =>
                  onChange({
                    ...filters,
                    creators: toggle(filters.creators, m.id),
                  })
                }
              />
            ))}
          </Facet>

          {catalogues.spaces.length > 0 ? (
            <Facet title="Team">
              <Chip
                label="No team"
                color="#6b7280"
                selected={filters.spaceIds.includes(NONE)}
                onPress={() =>
                  onChange({ ...filters, spaceIds: toggle(filters.spaceIds, NONE) })
                }
              />
              {catalogues.spaces.map((sp) => (
                <Chip
                  key={sp.id}
                  label={sp.name}
                  color="#0891b2"
                  selected={filters.spaceIds.includes(sp.id)}
                  onPress={() =>
                    onChange({
                      ...filters,
                      spaceIds: toggle(filters.spaceIds, sp.id),
                    })
                  }
                />
              ))}
            </Facet>
          ) : null}

          {catalogues.projects.length > 0 ? (
            <Facet title="Project">
              <Chip
                label="No project"
                color="#6b7280"
                selected={filters.projectIds.includes(NONE)}
                onPress={() =>
                  onChange({
                    ...filters,
                    projectIds: toggle(filters.projectIds, NONE),
                  })
                }
              />
              {catalogues.projects.map((pr) => (
                <Chip
                  key={pr.id}
                  label={pr.name}
                  color="#c026d3"
                  selected={filters.projectIds.includes(pr.id)}
                  onPress={() =>
                    onChange({
                      ...filters,
                      projectIds: toggle(filters.projectIds, pr.id),
                    })
                  }
                />
              ))}
            </Facet>
          ) : null}

          <Facet title="Source">
            {SOURCES.map((src) => (
              <Chip
                key={src.value}
                label={src.label}
                color="#475569"
                selected={filters.sources.includes(src.value)}
                onPress={() =>
                  onChange({
                    ...filters,
                    sources: toggle(filters.sources, src.value),
                  })
                }
              />
            ))}
          </Facet>

          {catalogues.customFields.map((field) => {
            const selected = filters.fieldValues[field.id] ?? [];
            const setField = (values: string[]) =>
              onChange({
                ...filters,
                fieldValues: { ...filters.fieldValues, [field.id]: values },
              });
            const options = Array.isArray(field.options)
              ? (field.options as { id?: string; label?: string }[])
              : [];
            return (
              <Facet key={field.id} title={field.name}>
                <Chip
                  label="Has a value"
                  color="#16a34a"
                  selected={selected.includes(FIELD_SET)}
                  onPress={() => setField(toggle(selected, FIELD_SET))}
                />
                <Chip
                  label="Empty"
                  color="#6b7280"
                  selected={selected.includes(FIELD_EMPTY)}
                  onPress={() => setField(toggle(selected, FIELD_EMPTY))}
                />
                {field.type === "checkbox"
                  ? ["true", "false"].map((v) => (
                      <Chip
                        key={v}
                        label={v === "true" ? "Checked" : "Unchecked"}
                        color="#2563eb"
                        selected={selected.includes(v)}
                        onPress={() => setField(toggle(selected, v))}
                      />
                    ))
                  : options.map((opt) => {
                      const id = String(opt.id ?? opt.label ?? "");
                      if (!id) return null;
                      return (
                        <Chip
                          key={id}
                          label={String(opt.label ?? id)}
                          color="#2563eb"
                          selected={selected.includes(id)}
                          onPress={() => setField(toggle(selected, id))}
                        />
                      );
                    })}
              </Facet>
            );
          })}

          <Facet title="Sort">
            {SORTS.map((s) => (
              <Chip
                key={s.value}
                label={s.label}
                color="#111827"
                selected={filters.sortBy === s.value}
                onPress={() => onChange({ ...filters, sortBy: s.value })}
              />
            ))}
          </Facet>
        </ScrollView>
      </SheetSurface>
    </Modal>
  );
}

function Facet({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.facet}>
      <Text style={styles.facetTitle}>{title}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Chip({
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
        styles.chip,
        selected && { backgroundColor: color, borderColor: color },
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  title: { fontSize: 16, fontWeight: "600" },
  clear: { fontSize: 16, color: "#dc2626" },
  done: { fontSize: 16, fontWeight: "600", color: "#2563eb" },
  disabled: { color: "#9ca3af" },
  content: { padding: 16, paddingBottom: 48, gap: 20 },
  facet: { gap: 10 },
  facetTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  chipText: { fontSize: 14, color: "#374151", fontWeight: "500" },
  chipTextSelected: { color: "#ffffff" },
});
