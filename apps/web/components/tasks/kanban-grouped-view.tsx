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
import type { EntityColor } from "@/lib/db/types";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { setTaskProject, setTaskSpace } from "@/components/projects/actions";
import { LABEL_CHIP } from "@/components/labels/label-tokens";

const NONE = "__none__";

const CHIP = LABEL_CHIP;

type GroupBy = "space" | "project";

/**
 * Board grouped by Space or Project (instead of status). Each column is a
 * space/project (plus an "Unassigned" column); dragging a card to a column
 * re-scopes the task via setTaskSpace / setTaskProject. The status kanban is
 * untouched — this is a parallel, lighter board for the other two groupings.
 */
export function KanbanGroupedView({
  propertyId,
  tasks,
  assignees,
  groupBy,
}: {
  propertyId: string;
  tasks: Task[];
  assignees: Record<string, AssigneeInfo>;
  groupBy: GroupBy;
}) {
  const qc = useQueryClient();
  const openTask = useOpenTask(propertyId);
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const [activeId, setActiveId] = useState<string | null>(null);

  const scopeKey = groupBy === "space" ? "space_id" : "project_id";
  const entities = groupBy === "space" ? spaces : projects;

  const columns = useMemo(() => {
    const cols = entities.map((e) => ({
      key: e.id,
      label: e.name,
      color: e.color as EntityColor,
    }));
    return [...cols, { key: NONE, label: "Unassigned", color: null }];
  }, [entities]);

  const byColumn = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const c of columns) m.set(c.key, []);
    for (const t of tasks) {
      const key = (t[scopeKey] as string | null | undefined) ?? NONE;
      (m.get(key) ?? m.get(NONE))!.push(t);
    }
    return m;
  }, [tasks, columns, scopeKey]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);

    // Target column key — a column droppable, or the column of the card hovered.
    let target: string;
    if (overId.startsWith("col:")) {
      target = overId.slice(4);
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      target = (overTask?.[scopeKey] as string | null | undefined) ?? NONE;
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
  onOpen,
}: {
  colKey: string;
  label: string;
  color: EntityColor | null;
  tasks: Task[];
  assignees: Record<string, AssigneeInfo>;
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
          "flex min-h-24 flex-1 flex-col gap-2 rounded-md p-1.5 transition-colors",
          isOver && "bg-accent-pressed",
        )}
      >
        {tasks.map((t) => (
          <DraggableCard
            key={t.id}
            task={t}
            assignee={t.assignee_id ? assignees[t.assignee_id] : undefined}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({
  task,
  assignee,
  onOpen,
}: {
  task: Task;
  assignee: AssigneeInfo | undefined;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <TaskCardOverlay task={task} assignee={assignee} />
    </div>
  );
}
