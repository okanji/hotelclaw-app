"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  shallow,
  useBroadcastEvent,
  useEventListener,
  useOthersMapped,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { CreateTaskDialog } from "./create-task-dialog";
import { PresenceBar } from "./presence-bar";
import { KanbanColumn } from "./kanban-column";
import { TaskCardOverlay } from "./task-card";
import { moveTask } from "./actions";
import {
  COLUMNS,
  STATUS_IDS,
  computePosition,
  isColumnId,
  type Task,
} from "./kanban";
import type { TaskStatus } from "@/lib/db/types";

const EMPTY_TASKS: Task[] = [];

type BoardState = {
  columns: Record<TaskStatus, string[]>;
  byId: Record<string, Task>;
};

/** Group tasks into ordered columns keyed by status. */
function buildBoard(tasks: Task[]): BoardState {
  const columns: Record<TaskStatus, string[]> = {
    todo: [],
    in_progress: [],
    blocked: [],
    done: [],
  };
  const byId: Record<string, Task> = {};
  for (const task of [...tasks].sort((a, b) => a.position - b.position)) {
    byId[task.id] = task;
    columns[task.status]?.push(task.id);
  }
  return { columns, byId };
}

/** Which column an id lives in — a card id, or a column id itself. */
function columnOf(
  columns: Record<TaskStatus, string[]>,
  id: string,
): TaskStatus | null {
  if (isColumnId(id)) return id;
  for (const status of STATUS_IDS) {
    if (columns[status].includes(id)) return status;
  }
  return null;
}

export function TasksBoard({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const broadcast = useBroadcastEvent();
  const updateMyPresence = useUpdateMyPresence();
  const searchParams = useSearchParams();
  const mineOnly = searchParams.get("view") === "mine";

  const { data } = useQuery<Task[]>({
    queryKey: ["tasks", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/tasks`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load tasks");
      return res.json();
    },
  });
  // "My tasks" saved view (?view=mine) filters the board to the current
  // user's assignments; otherwise the board shows every task.
  const tasks = useMemo(() => {
    const all = data ?? EMPTY_TASKS;
    return mineOnly
      ? all.filter((t) => t.assignee_id === currentUserId)
      : all;
  }, [data, mineOnly, currentUserId]);

  // Local, drag-mutable copy of the board. Kept in sync with the server,
  // except while this user is mid-drag.
  const [board, setBoard] = useState<BoardState>(() => buildBoard(EMPTY_TASKS));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo");
  const draggingRef = useRef(false);
  const lastOverId = useRef<string | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    setBoard(buildBoard(tasks));
  }, [tasks]);

  // Teammates dragging cards right now -> { taskId: their name }.
  const othersDragging = useOthersMapped(
    (other) => ({
      taskId: other.presence.draggingTaskId,
      name: other.info?.name ?? "A teammate",
    }),
    shallow,
  );
  const remoteDragMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [, value] of othersDragging) {
      if (value.taskId) map.set(value.taskId, value.name);
    }
    return map;
  }, [othersDragging]);

  useEventListener(({ event }) => {
    if (event.type === "tasks-invalidate" || event.type === "task-invalidate") {
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    } else if (event.type === "task-moved") {
      // A teammate moved a card. Patch the cache so it slides into place
      // (TaskCard's FLIP animation makes it smooth) without a refetch flash.
      qc.setQueryData<Task[]>(["tasks", propertyId], (old) =>
        old?.map((t) =>
          t.id === event.taskId
            ? { ...t, status: event.status, position: event.position }
            : t,
        ),
      );
    }
  });

  const notifyChanged = useCallback(() => {
    broadcast({ type: "tasks-invalidate" });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }, [broadcast, qc, propertyId]);

  /** Optimistically apply a move, broadcast it, then persist it. */
  const persistMove = useCallback(
    async (taskId: string, status: TaskStatus, position: number) => {
      qc.setQueryData<Task[]>(["tasks", propertyId], (old) =>
        old?.map((t) => (t.id === taskId ? { ...t, status, position } : t)),
      );
      broadcast({ type: "task-moved", taskId, status, position });
      const result = await moveTask({ taskId, status, position });
      if ("error" in result) {
        toast.error(result.error);
      }
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    },
    [qc, propertyId, broadcast],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Pointer-driven collision detection. The target column is chosen by where
  // the cursor actually is — not by the dragged card's rect, which shifts as
  // columns resize mid-drag and would otherwise make the card "snap" a column
  // too far. When the cursor is over a column's empty space, resolve to the
  // closest card *within that same column*.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const hits =
        pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      let overId = getFirstCollision(hits, "id");

      if (overId != null) {
        const overIdStr = String(overId);
        if (isColumnId(overIdStr)) {
          const cards = board.columns[overIdStr];
          if (cards.length > 0) {
            const inColumn = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (c) => c.id !== overId && cards.includes(String(c.id)),
              ),
            });
            overId = getFirstCollision(inColumn, "id") ?? overId;
          }
        }
        lastOverId.current = String(overId);
        return [{ id: overId }];
      }

      // Cursor is in a gap between droppables — hold the last known target
      // so the drop preview doesn't flicker.
      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [board.columns],
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    draggingRef.current = true;
    lastOverId.current = null;
    setActiveId(id);
    updateMyPresence({ draggingTaskId: id });
  }

  // Live cross-column preview: while hovering a different column, move the
  // dragged card into it so the gap opens up under the cursor.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (id === overId) return;

    setBoard((prev) => {
      const fromCol = columnOf(prev.columns, id);
      const toCol = columnOf(prev.columns, overId);
      if (!fromCol || !toCol || fromCol === toCol) return prev;

      const toItems = prev.columns[toCol];
      let insertAt = toItems.length;
      if (!isColumnId(overId)) {
        const overIndex = toItems.indexOf(overId);
        const activeRect = active.rect.current.translated;
        const below =
          activeRect && over.rect
            ? activeRect.top > over.rect.top + over.rect.height / 2
            : false;
        insertAt =
          overIndex >= 0 ? overIndex + (below ? 1 : 0) : toItems.length;
      }
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [fromCol]: prev.columns[fromCol].filter((x) => x !== id),
          [toCol]: [
            ...toItems.slice(0, insertAt),
            id,
            ...toItems.slice(insertAt),
          ],
        },
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    draggingRef.current = false;
    const id = String(active.id);
    setActiveId(null);
    updateMyPresence({ draggingTaskId: null });

    const column = columnOf(board.columns, id);
    if (!over || !column) {
      setBoard(buildBoard(tasks));
      return;
    }

    const overId = String(over.id);
    const items = board.columns[column];
    const oldIndex = items.indexOf(id);
    const newIndex = isColumnId(overId)
      ? items.length - 1
      : items.indexOf(overId) >= 0
        ? items.indexOf(overId)
        : items.length - 1;

    // Dropped back in its original column and slot — nothing to persist.
    if (board.byId[id]?.status === column && oldIndex === newIndex) {
      setBoard(buildBoard(tasks));
      return;
    }

    const finalItems =
      oldIndex !== newIndex && oldIndex >= 0 && newIndex >= 0
        ? arrayMove(items, oldIndex, newIndex)
        : items;

    setBoard((prev) => ({
      ...prev,
      columns: { ...prev.columns, [column]: finalItems },
    }));

    const idx = finalItems.indexOf(id);
    const before = idx > 0 ? board.byId[finalItems[idx - 1]] : undefined;
    const after =
      idx < finalItems.length - 1 ? board.byId[finalItems[idx + 1]] : undefined;
    const position = computePosition(
      before?.position ?? null,
      after?.position ?? null,
    );

    void persistMove(id, column, position);
  }

  function handleDragCancel() {
    draggingRef.current = false;
    setActiveId(null);
    updateMyPresence({ draggingTaskId: null });
    setBoard(buildBoard(tasks));
  }

  /** "Move to" from a card's menu — drops the card at the top of a column. */
  const handleMoveToColumn = useCallback(
    (taskId: string, status: TaskStatus) => {
      const from = columnOf(board.columns, taskId);
      if (!from || from === status) return;
      const topId = board.columns[status][0];
      const position = computePosition(
        null,
        topId ? (board.byId[topId]?.position ?? null) : null,
      );
      setBoard((prev) => ({
        ...prev,
        columns: {
          ...prev.columns,
          [from]: prev.columns[from].filter((x) => x !== taskId),
          [status]: [
            taskId,
            ...prev.columns[status].filter((x) => x !== taskId),
          ],
        },
      }));
      void persistMove(taskId, status, position);
    },
    [board, persistMove],
  );

  const openCreate = useCallback((status: TaskStatus) => {
    setCreateStatus(status);
    setCreateOpen(true);
  }, []);

  const activeColumn = activeId ? columnOf(board.columns, activeId) : null;
  const activeTask = activeId ? board.byId[activeId] : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={mineOnly ? "My tasks" : "Tasks"}
        icon={<ListChecks />}
        actions={
          <>
            <PresenceBar />
            <Button size="sm" onClick={() => openCreate("todo")}>
              <Plus />
              New task
            </Button>
          </>
        }
      />
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              taskIds={board.columns[column.id]}
              tasksById={board.byId}
              propertyId={propertyId}
              dragActive={activeId !== null}
              isDropTarget={activeColumn === column.id}
              remoteDragMap={remoteDragMap}
              onMove={handleMoveToColumn}
              onChanged={notifyChanged}
              onAddCard={openCreate}
            />
          ))}
        </div>
        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
          }}
        >
          {activeTask ? <TaskCardOverlay task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>
      <CreateTaskDialog
        propertyId={propertyId}
        status={createStatus}
        onStatusChange={setCreateStatus}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={notifyChanged}
      />
    </div>
  );
}
