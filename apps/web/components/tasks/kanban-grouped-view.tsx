"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TaskCardOverlay } from "./task-card";
import type { Task } from "./kanban";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { CustomFieldOption, EntityColor } from "@/lib/db/types";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import {
  customFieldsQueryOptions,
  propertyTaskFieldValuesQueryOptions,
} from "@/lib/query/custom-field-queries";
import { optionColor, valueOptionIds } from "@/lib/tasks/custom-field-options";
import { setTaskProject, setTaskSpace } from "@/components/projects/actions";
import { setTaskFieldValue } from "./field-actions";
import { LABEL_CHIP } from "@/components/labels/label-tokens";

const NONE = "__none__";
/**
 * Draggable ids are `${taskId}@@${columnKey}`: under a label (multi_select)
 * grouping the SAME task legitimately renders in several columns (ClickUp's
 * default — a task with two labels appears under both), and dnd-kit requires
 * unique draggable ids.
 */
const CARD_ID_SEP = "@@";

const CHIP = LABEL_CHIP;

/** `field:<uuid>` groups by a dropdown/label custom field, ClickUp-style. */
type GroupBy = "space" | "project" | `field:${string}`;

/**
 * Board grouped by Team, Project, or a choice custom field (instead of
 * status). Each column is one entity/option (plus a "None" column); dragging
 * a card re-scopes the task — space/project via their actions, field values
 * via `setTaskFieldValue`. For label fields a drag out of one option column
 * into another swaps that option and keeps the rest of the task's labels.
 * The status kanban is untouched — this is a parallel, lighter board.
 */
export function KanbanGroupedView({
  propertyId,
  tasks,
  assignees,
  cardLabels,
  groupBy,
}: {
  propertyId: string;
  tasks: Task[];
  assignees: Record<string, AssigneeInfo>;
  /** taskId → label-field chips, resolved board-level. */
  cardLabels: Record<string, CustomFieldOption[]>;
  groupBy: GroupBy;
}) {
  const qc = useQueryClient();
  const openTask = useOpenTask(propertyId);
  const isFieldGroup = groupBy.startsWith("field:");
  const fieldId = isFieldGroup ? groupBy.slice("field:".length) : null;

  const { data: spaces = [] } = useQuery({
    ...spacesQueryOptions(propertyId),
    enabled: !isFieldGroup,
  });
  const { data: projects = [] } = useQuery({
    ...projectsQueryOptions(propertyId),
    enabled: !isFieldGroup,
  });
  const { data: fields = [] } = useQuery({
    ...customFieldsQueryOptions(propertyId),
    enabled: isFieldGroup,
  });
  const { data: valueRows = [] } = useQuery({
    ...propertyTaskFieldValuesQueryOptions(propertyId),
    enabled: isFieldGroup,
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  const field = fieldId ? (fields.find((f) => f.id === fieldId) ?? null) : null;

  const scopeKey = groupBy === "space" ? "space_id" : "project_id";

  // task id → option ids currently set for the grouping field.
  const fieldIdsByTask = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!fieldId) return m;
    for (const row of valueRows) {
      if (row.field_id !== fieldId) continue;
      m.set(row.task_id, valueOptionIds(row.value));
    }
    return m;
  }, [valueRows, fieldId]);

  const columns = useMemo(() => {
    if (isFieldGroup) {
      const opts = field?.options ?? [];
      return [
        ...opts.map((o) => ({
          key: o.id,
          label: o.label,
          color: optionColor(o),
        })),
        { key: NONE, label: "None", color: null },
      ];
    }
    const entities = groupBy === "space" ? spaces : projects;
    const cols = entities.map((e) => ({
      key: e.id,
      label: e.name,
      color: e.color as EntityColor,
    }));
    return [...cols, { key: NONE, label: "Unassigned", color: null }];
  }, [isFieldGroup, field, groupBy, spaces, projects]);

  const byColumn = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const c of columns) m.set(c.key, []);
    for (const t of tasks) {
      if (isFieldGroup) {
        // A multi-value task appears in EVERY matching column (ClickUp's
        // default grouping for labels); unknown/cleared ids land in None.
        const ids = (fieldIdsByTask.get(t.id) ?? []).filter((id) => m.has(id));
        if (ids.length === 0) m.get(NONE)!.push(t);
        else for (const id of ids) m.get(id)!.push(t);
        continue;
      }
      const key = (t[scopeKey] as string | null | undefined) ?? NONE;
      (m.get(key) ?? m.get(NONE))!.push(t);
    }
    return m;
  }, [tasks, columns, scopeKey, isFieldGroup, fieldIdsByTask]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  const activeTaskId = activeId ? activeId.split(CARD_ID_SEP)[0]! : null;
  const activeTask = activeTaskId
    ? tasks.find((t) => t.id === activeTaskId)
    : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const [taskId, sourceCol] = String(active.id).split(CARD_ID_SEP) as [
      string,
      string,
    ];
    const overId = String(over.id);

    // Target column key — a column droppable, or the column of the card
    // hovered (composite id carries it).
    const target = overId.startsWith("col:")
      ? overId.slice(4)
      : (overId.split(CARD_ID_SEP)[1] ?? NONE);
    if (target === sourceCol) return;

    if (isFieldGroup) {
      if (!field) return;
      const current = fieldIdsByTask.get(taskId) ?? [];
      let next: string[] | null;
      if (target === NONE) {
        // Dropping on None clears the field — for labels that means all of
        // them, which is what "this task now has no value here" says.
        next = null;
      } else if (field.type === "select") {
        next = [target];
      } else {
        // Label field: swap the source column's option for the target's,
        // keep everything else the task carries.
        const kept = current.filter((id) => id !== sourceCol);
        next = kept.includes(target) ? kept : [...kept, target];
        if (next.length === 0) next = null;
      }

      const valueKey = ["task-field-values-property", propertyId] as const;
      type Row = { task_id: string; field_id: string; value: unknown };
      const prev = qc.getQueryData<Row[]>(valueKey);
      qc.setQueryData<Row[]>(valueKey, (old) => {
        const rest = (old ?? []).filter(
          (r) => !(r.task_id === taskId && r.field_id === field.id),
        );
        if (next === null) return rest;
        const stored = field.type === "select" ? next[0]! : next;
        return [...rest, { task_id: taskId, field_id: field.id, value: stored }];
      });

      const res = await setTaskFieldValue({
        propertyId,
        taskId,
        fieldId: field.id,
        value: field.type === "select" ? (next?.[0] ?? null) : next,
      });
      if ("error" in res) {
        if (prev) qc.setQueryData(valueKey, prev);
        toast.error(res.error);
      } else {
        void qc.invalidateQueries({ queryKey: valueKey });
        void qc.invalidateQueries({ queryKey: ["task-field-values"] });
      }
      return;
    }

    const task = tasks.find((t) => t.id === taskId);
    const current = (task?.[scopeKey] as string | null | undefined) ?? NONE;
    if (current === target) return;

    const next = target === NONE ? null : target;
    // Optimistic.
    const prev = qc.getQueryData<Task[]>(["tasks", propertyId]);
    qc.setQueryData<Task[]>(["tasks", propertyId], (old) =>
      old?.map((t) => (t.id === taskId ? { ...t, [scopeKey]: next } : t)),
    );
    const res =
      groupBy === "space"
        ? await setTaskSpace(taskId, next)
        : await setTaskProject(taskId, next);
    if ("error" in res) {
      if (prev) qc.setQueryData(["tasks", propertyId], prev);
      toast.error(res.error);
    } else {
      void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    }
  }

  if (isFieldGroup && fields.length > 0 && !field) {
    return (
      <p className="px-6 py-10 text-center text-sm text-muted-foreground">
        That field is gone — pick another grouping.
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
        {columns.map((col) => (
          <Column
            key={col.key}
            colKey={col.key}
            label={col.label}
            color={col.color}
            tasks={byColumn.get(col.key) ?? []}
            assignees={assignees}
            cardLabels={cardLabels}
            onOpen={openTask}
          />
        ))}
      </div>
      <PortalDragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2,0,0,1)" }}>
        {activeTask ? (
          <TaskCardOverlay
            task={activeTask}
            assignee={
              activeTask.assignee_id ? assignees[activeTask.assignee_id] : undefined
            }
            labels={cardLabels[activeTask.id]}
          />
        ) : null}
      </PortalDragOverlay>
    </DndContext>
  );
}

function Column({
  colKey,
  label,
  color,
  tasks,
  assignees,
  cardLabels,
  onOpen,
}: {
  colKey: string;
  label: string;
  color: EntityColor | null;
  tasks: Task[];
  assignees: Record<string, AssigneeInfo>;
  cardLabels: Record<string, CustomFieldOption[]>;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${colKey}` });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      {/* Group header = the entity-hued status PILL + a faint count
          (notion-spec-v2 §6). The bare dot + primary-ink heading it replaces
          was the generic-kanban shape. */}
      <div className="mb-2 flex items-center gap-2 px-1">
        <h3
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-pill px-1.5 text-sm font-medium whitespace-nowrap",
            color ? CHIP[color] : "bg-pill-neutral text-pill-neutral-ink",
          )}
        >
          {label}
        </h3>
        <span className="text-sm text-faint-foreground tabular-nums">
          {tasks.length}
        </span>
      </div>
      {/* No column background — cards float on the page plane. */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2.5 rounded-md p-1.5 transition-colors",
          isOver && "bg-accent-pressed",
        )}
      >
        {tasks.map((t) => (
          <DraggableCard
            key={t.id}
            task={t}
            colKey={colKey}
            assignee={t.assignee_id ? assignees[t.assignee_id] : undefined}
            labels={cardLabels[t.id]}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({
  task,
  colKey,
  assignee,
  labels,
  onOpen,
}: {
  task: Task;
  colKey: string;
  assignee: AssigneeInfo | undefined;
  labels: CustomFieldOption[] | undefined;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `${task.id}${CARD_ID_SEP}${colKey}` });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <TaskCardOverlay task={task} assignee={assignee} labels={labels} />
    </div>
  );
}
