"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publishVisibleTaskOrder } from "@/lib/tasks/visible-task-order";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  shallow,
  useBroadcastEvent,
  useEventListener,
  useOthersMapped,
  useUpdateMyPresence,
} from "@liveblocks/react";
import {
  closestCenter,
  DndContext,
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
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { toast } from "sonner";
import { KanbanColumn } from "./kanban-column";
import { TaskCardOverlay } from "./task-card";
import { moveTask } from "./actions";
import { computePosition, type Task } from "./kanban";
import {
  columnOfTask,
  columnPatch,
  doneTargetFor,
  isDoneColumn,
  type BoardColumns,
  type ColumnDef,
} from "@/lib/tasks/statuses";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { CustomFieldOption } from "@/lib/db/types";

type BoardState = {
  /** Column id → ordered card ids. Keys are the board's column ids (0114:
   *  status uuids on a list board, legacy literals on the category board). */
  columns: Record<string, string[]>;
  byId: Record<string, Task>;
};

/** Group tasks into ordered columns keyed by the board's column ids. */
function buildBoard(board: BoardColumns, tasks: Task[]): BoardState {
  const columns: Record<string, string[]> = {};
  for (const c of board.columns) columns[c.id] = [];
  const byId: Record<string, Task> = {};
  for (const task of tasks) {
    byId[task.id] = task;
    columns[columnOfTask(board, task)]?.push(task.id);
  }
  return { columns, byId };
}

type Props = {
  propertyId: string;
  /** Already-filtered, already-sorted tasks. */
  tasks: Task[];
  /** The columns this board shows — one list's pipeline or the 4 categories. */
  board: BoardColumns;
  assignees: Record<string, AssigneeInfo>;
  /** taskId → label-field chips, resolved board-level. */
  cardLabels: Record<string, CustomFieldOption[]>;
  hideDone: boolean;
  onOpenFullCreate: (status: string) => void;
  /** Active team scope (`?space=`), threaded to inline quick-add. */
  scopeSpaceId?: string | null;
  /** Active list scope (`?list=`), threaded to inline quick-add. */
  scopeListId?: string | null;
};

export function KanbanView({
  propertyId,
  tasks,
  board,
  assignees,
  cardLabels,
  scopeSpaceId,
  scopeListId,
  hideDone,
  onOpenFullCreate,
}: Props) {
  const qc = useQueryClient();
  const broadcast = useBroadcastEvent();
  const updateMyPresence = useUpdateMyPresence();

  const columnIds = useMemo(
    () => new Set(board.columns.map((c) => c.id)),
    [board],
  );
  const isColumnId = useCallback((id: string) => columnIds.has(id), [columnIds]);
  const columnDef = useCallback(
    (id: string): ColumnDef | undefined => board.columns.find((c) => c.id === id),
    [board],
  );

  /** Which column an id lives in — a card id, or a column id itself. */
  const columnOf = useCallback(
    (columns: Record<string, string[]>, id: string): string | null => {
      if (columnIds.has(id)) return id;
      for (const c of board.columns) {
        if (columns[c.id]?.includes(id)) return c.id;
      }
      return null;
    },
    [board, columnIds],
  );

  const [boardState, setBoard] = useState<BoardState>(() =>
    buildBoard(board, tasks),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const draggingRef = useRef(false);
  const lastOverId = useRef<string | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    setBoard(buildBoard(board, tasks));
  }, [board, tasks]);

  // Publish the on-screen order (columns left→right, cards top→bottom,
  // hidden/collapsed columns skipped) so task-detail prev/next follows it.
  useEffect(() => {
    const ids: string[] = [];
    for (const column of board.columns) {
      if (collapsed[column.id] || (hideDone && isDoneColumn(column))) continue;
      ids.push(...(boardState.columns[column.id] ?? []));
    }
    publishVisibleTaskOrder(propertyId, ids);
  }, [board, boardState.columns, collapsed, hideDone, propertyId]);

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

  /**
   * The row patch for a card dropped on a column — both the legacy literal
   * and the status row fields, so `columnOfTask` keeps the card where it
   * landed until the refetch confirms. A column id this board doesn't know
   * (a peer on a differently scoped board) falls back to the bare write.
   */
  const patchFor = useCallback(
    (status: string, position: number): Partial<Task> => {
      const def = columnDef(status);
      if (def) return { ...columnPatch(board, def), position };
      return status.includes("-")
        ? { status_id: status, position }
        : { status: status as Task["status"], position };
    },
    [board, columnDef],
  );

  useEventListener(({ event }) => {
    if (event.type === "tasks-invalidate" || event.type === "task-invalidate") {
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    } else if (event.type === "task-moved") {
      const patch = patchFor(event.status, event.position);
      qc.setQueryData<Task[]>(["tasks", propertyId], (old) =>
        old?.map((t) => (t.id === event.taskId ? { ...t, ...patch } : t)),
      );
    }
  });

  const notifyChanged = useCallback(() => {
    broadcast({ type: "tasks-invalidate" });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }, [broadcast, qc, propertyId]);

  /**
   * Move mutation — wraps `moveTask` in React Query's optimistic-update
   * lifecycle so back-to-back drags don't fight each other.
   *
   * The bug we're solving: with the previous "setQueryData → await → always
   * invalidate" pattern, dragging A→B then B→C quickly could land like this:
   *
   *   move-1 (A→B) resolves   → invalidate → refetch
   *   refetch returns server state where move-2 hasn't committed yet
   *     → cache snapshot becomes B → card briefly snaps back to B
   *   move-2 (B→C) resolves   → invalidate → refetch → finally lands in C
   *
   * The fix is the standard TkDodo "Mastering Mutations" pattern:
   *
   *   - `onMutate` calls `cancelQueries` BEFORE applying the optimistic
   *     update, so any in-flight refetch from a previous mutation's
   *     `onSettled` is discarded instead of overwriting us.
   *   - `onSettled` only invalidates when this is the LAST inflight
   *     move-task mutation (`isMutating <= 1`); otherwise the next
   *     mutation's `onSettled` will do the final refetch with up-to-date
   *     server state.
   *   - `onError` rolls back to the snapshot.
   *
   * Note: the mutation key is scoped to `propertyId`, so moves on different
   * properties don't accidentally suppress each other's refetch.
   */
  const moveMutationKey = useMemo(
    () => ["move-task", propertyId] as const,
    [propertyId],
  );

  const { mutate: moveMutate } = useMutation({
    mutationKey: moveMutationKey,
    mutationFn: async (vars: {
      taskId: string;
      status: string;
      position: number;
    }) => {
      const result = await moveTask(vars);
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    onMutate: async (vars) => {
      // Cancel any in-flight refetch so it can't overwrite the optimistic
      // update with stale data.
      await qc.cancelQueries({ queryKey: ["tasks", propertyId] });
      const prev = qc.getQueryData<Task[]>(["tasks", propertyId]);
      const patch = patchFor(vars.status, vars.position);
      qc.setQueryData<Task[]>(["tasks", propertyId], (old) =>
        old?.map((t) => (t.id === vars.taskId ? { ...t, ...patch } : t)),
      );
      broadcast({
        type: "task-moved",
        taskId: vars.taskId,
        status: vars.status,
        position: vars.position,
      });
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks", propertyId], ctx.prev);
      toast.error(
        err instanceof Error ? err.message : "Could not move task",
      );
    },
    onSettled: () => {
      // Only the LAST inflight move triggers the refetch; earlier moves'
      // refetches would land with stale server state and bounce the card
      // back. `isMutating` counts this mutation too, hence `<= 1`.
      if (qc.isMutating({ mutationKey: moveMutationKey }) <= 1) {
        qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      }
    },
  });

  const persistMove = useCallback(
    (taskId: string, status: string, position: number) => {
      moveMutate({ taskId, status, position });
    },
    [moveMutate],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Pointer-driven collision detection. Same logic as before the refactor —
  // see the previous `board.tsx` for the full rationale.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const hits =
        pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      let overId = getFirstCollision(hits, "id");

      if (overId != null) {
        const overIdStr = String(overId);
        if (isColumnId(overIdStr)) {
          const cards = boardState.columns[overIdStr] ?? [];
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

      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [boardState.columns, isColumnId],
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    draggingRef.current = true;
    lastOverId.current = null;
    setActiveId(id);
    updateMyPresence({ draggingTaskId: id });
  }

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

      const toItems = prev.columns[toCol] ?? [];
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
          [fromCol]: (prev.columns[fromCol] ?? []).filter((x) => x !== id),
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

    const column = columnOf(boardState.columns, id);
    if (!over || !column) {
      setBoard(buildBoard(board, tasks));
      return;
    }

    const overId = String(over.id);
    const items = boardState.columns[column] ?? [];
    const oldIndex = items.indexOf(id);
    const newIndex = isColumnId(overId)
      ? items.length - 1
      : items.indexOf(overId) >= 0
        ? items.indexOf(overId)
        : items.length - 1;

    const task = boardState.byId[id];
    if (task && columnOfTask(board, task) === column && oldIndex === newIndex) {
      setBoard(buildBoard(board, tasks));
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
    const before = idx > 0 ? boardState.byId[finalItems[idx - 1]] : undefined;
    const after =
      idx < finalItems.length - 1
        ? boardState.byId[finalItems[idx + 1]]
        : undefined;
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
    setBoard(buildBoard(board, tasks));
  }

  const toggleCollapsed = useCallback(
    (status: string) =>
      setCollapsed((prev) => ({ ...prev, [status]: !prev[status] })),
    [],
  );

  const activeColumn = activeId ? columnOf(boardState.columns, activeId) : null;
  const activeTask = activeId ? boardState.byId[activeId] : null;
  const activeAssignee =
    activeTask?.assignee_id ? assignees[activeTask.assignee_id] : undefined;
  const doneTarget = doneTargetFor(board);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // Measure droppables only WHILE dragging (dnd-kit's default). The old
      // `MeasuringStrategy.Always` never disables measuring, so it called
      // getBoundingClientRect on every droppable — the 4 columns AND all ~80+
      // cards (each useSortable is a droppable) — on *every* board re-render,
      // including each keystroke in the filter box (measured: ~68 forced
      // reflows per keystroke). `WhileDragging` still re-measures during an
      // active drag as columns reflow (the measuring effect re-runs when the
      // sortable set changes), so drop accuracy is unaffected.
      measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-(--page-gutter) py-3">
        {board.columns.map((column) => {
          // Done columns can be force-collapsed by the toolbar's "Hide done"
          // toggle without touching the per-column collapse state.
          const isCollapsed =
            collapsed[column.id] || (hideDone && isDoneColumn(column));
          return (
            <KanbanColumn
              key={column.id}
              column={column}
              doneTarget={doneTarget}
              taskIds={boardState.columns[column.id] ?? []}
              tasksById={boardState.byId}
              assignees={assignees}
              cardLabels={cardLabels}
              propertyId={propertyId}
              dragActive={activeId !== null}
              activeDragId={activeId}
              isDropTarget={activeColumn === column.id}
              collapsed={isCollapsed}
              onToggleCollapse={toggleCollapsed}
              remoteDragMap={remoteDragMap}
              onChanged={notifyChanged}
              onOpenFullCreate={onOpenFullCreate}
              scopeSpaceId={scopeSpaceId}
              scopeListId={scopeListId}
            />
          );
        })}
      </div>
      <PortalDragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeTask ? (
          <TaskCardOverlay
            task={activeTask}
            assignee={activeAssignee}
            labels={cardLabels[activeTask.id]}
          />
        ) : null}
      </PortalDragOverlay>
    </DndContext>
  );
}
