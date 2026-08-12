"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { cn } from "@/lib/utils";
import {
  customFieldsQueryOptions,
  propertyTaskFieldValuesQueryOptions,
  type CustomFieldRow,
} from "@/lib/query/custom-field-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  TASKS_LIST_VIEW_KEY,
  taskViewLayoutQueryOptions,
} from "@/lib/query/task-view-queries";
import {
  CALC_LABEL,
  computeColumnCalc,
  DEFAULT_COLUMNS,
  newColumnEntry,
  resolveColumns,
  sortTasks,
  type ColumnCalc,
  type ResolvedColumn,
  type SortContext,
} from "@/lib/tasks/list-columns";
import { taskHref } from "@/lib/tasks/task-href";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type {
  CustomFieldValue,
  EntityColor,
  TaskStatus,
  TaskViewColumn,
  TaskViewSort,
} from "@/lib/db/types";
import { deleteTask, moveTask, updateTask } from "./actions";
import { saveTaskViewLayout } from "./list-view-actions";
import {
  COLUMNS,
  COLUMN_PILL_CLASS,
  PRIORITY_META,
  PRIORITY_IDS,
  STATUS_IDS,
  computePosition,
  type Task,
} from "./kanban";
import { PriorityBars, StatusIcon } from "./task-icons";
import { ListCell, type CellContext } from "./list-cells";
import {
  AddColumnButton,
  ColumnHeaderMenu,
  SortNotice,
} from "./list-column-controls";
import { BulkFieldMenus } from "./list-bulk-edit";

/**
 * The tasks LIST view — a configurable table, not a fixed five-column
 * readout. Modelled on ClickUp's List view:
 *
 *   • columns are added from a "+" at the end of the header row, from either
 *     the built-in task properties or any custom field (including a new one
 *     created right there);
 *   • header drag reorders columns, the header menu sorts / moves / hides,
 *     and the right edge of each header resizes;
 *   • every cell edits in place through the same server actions the task
 *     page uses, so an edit here fires the same workflow automations;
 *   • rows drag to reorder — but ONLY while unsorted. A manual drag under an
 *     active sort has nowhere to persist to, so ClickUp disables it within a
 *     group and we do the same; dragging into a DIFFERENT group still works,
 *     because that's a status change rather than a reorder.
 *
 * The layout is per-user (`task_view_columns`, migration 0099).
 */

type Props = {
  propertyId: string;
  tasks: Task[];
  /** Sub-tasks by parent id — rendered as expandable indented rows. */
  childrenByParent?: Map<string, Task[]>;
  assignees: Record<string, AssigneeInfo>;
  hideDone: boolean;
  onChanged: () => void;
  onOpenFullCreate: (status: TaskStatus) => void;
};

/** Fixed gutters: the select checkbox / drag handle, and the row menu. */
const LEAD_WIDTH = 40;
const TRAIL_WIDTH = 40;
const TITLE_MIN = 240;

export function ListView({
  propertyId,
  tasks,
  childrenByParent,
  assignees,
  hideDone,
  onChanged,
  onOpenFullCreate,
}: Props) {
  const qc = useQueryClient();

  /* ── Data behind the columns ──────────────────────────────────────────── */
  const { data: fields = [] } = useQuery(customFieldsQueryOptions(propertyId));
  const { data: fieldValueRows = [] } = useQuery(
    propertyTaskFieldValuesQueryOptions(propertyId),
  );
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: savedLayout } = useQuery(
    taskViewLayoutQueryOptions(propertyId),
  );

  /* ── Layout ───────────────────────────────────────────────────────────── */
  // The react-query cache is the single store: `persist` writes the new layout
  // into it synchronously, so a column drag or resize paints immediately and
  // the server action is fire-and-forget behind it.
  const stored = useMemo(
    () => savedLayout?.columns ?? DEFAULT_COLUMNS,
    [savedLayout],
  );
  const sort = savedLayout?.sort ?? null;

  const persist = useCallback(
    (next: { columns: TaskViewColumn[]; sort: TaskViewSort }) => {
      qc.setQueryData(
        ["task-view-layout", propertyId, TASKS_LIST_VIEW_KEY],
        next,
      );
      void saveTaskViewLayout({
        propertyId,
        viewKey: TASKS_LIST_VIEW_KEY,
        columns: next.columns,
        sort: next.sort,
      }).then((res) => {
        if ("error" in res) toast.error(res.error);
      });
    },
    [propertyId, qc],
  );

  const columns = useMemo(
    () => resolveColumns(stored, fields),
    [stored, fields],
  );

  /* ── Lookups ──────────────────────────────────────────────────────────── */
  const fieldIndex = useMemo(() => {
    const map = new Map<string, Map<string, CustomFieldValue>>();
    for (const row of fieldValueRows) {
      let perTask = map.get(row.task_id);
      if (!perTask) {
        perTask = new Map();
        map.set(row.task_id, perTask);
      }
      perTask.set(row.field_id, row.value);
    }
    return map;
  }, [fieldValueRows]);

  const spaceById = useMemo(
    () => new Map(spaces.map((s) => [s.id, s])),
    [spaces],
  );

  const [now] = useState(() => Date.now());
  const cellCtx: CellContext = useMemo(
    () => ({
      propertyId,
      now,
      assignees,
      members,
      spaceName: (id) => (id ? (spaceById.get(id)?.name ?? "") : ""),
      spaceColor: (id) =>
        id ? ((spaceById.get(id)?.color as EntityColor) ?? null) : null,
      fieldValue: (taskId, fieldId) =>
        fieldIndex.get(taskId)?.get(fieldId) ?? null,
      onChanged: () => {
        void qc.invalidateQueries({
          queryKey: ["task-field-values-property", propertyId],
        });
        // Per-task caches too (["task-field-values", <taskId>] — the prefix
        // matches every task's key but not the property key above), so an
        // open task drawer reflects a list-cell edit immediately.
        void qc.invalidateQueries({ queryKey: ["task-field-values"] });
        onChanged();
      },
    }),
    [propertyId, now, assignees, members, spaceById, fieldIndex, qc, onChanged],
  );

  const sortCtx: SortContext = useMemo(
    () => ({
      assigneeName: (id) => (id ? (assignees[id]?.name ?? "") : ""),
      spaceName: (id) => (id ? (spaceById.get(id)?.name ?? "") : ""),
      fieldValue: (taskId, fieldId) =>
        fieldIndex.get(taskId)?.get(fieldId) ?? null,
    }),
    [assignees, spaceById, fieldIndex],
  );

  /* ── Selection ────────────────────────────────────────────────────────── */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [collapsed, setCollapsed] = useState<Record<TaskStatus, boolean>>({
    todo: false,
    in_progress: false,
    blocked: false,
    done: false,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visibleIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const activeSelection = useMemo(
    () => new Set([...selected].filter((id) => visibleIds.has(id))),
    [selected, visibleIds],
  );
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* ── Grouping + ordering ──────────────────────────────────────────────── */
  const byId = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    };
    for (const t of tasks) map[t.status].push(t);
    for (const status of STATUS_IDS) {
      map[status] = sortTasks(map[status], sort, columns, sortCtx);
    }
    return map;
  }, [tasks, sort, columns, sortCtx]);

  // Row order held locally while a drag is in flight, so the row follows the
  // pointer between groups before the server has agreed.
  const [order, setOrder] = useState<Record<TaskStatus, string[]>>(() =>
    buildOrder(grouped),
  );
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setOrder(buildOrder(grouped));
  }, [grouped]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Sorted only while the sort's column actually resolves — an archived
  // field used to leave `sort` set but the column gone, which kept
  // drag-to-reorder disabled with no SortNotice explaining why and no way
  // to clear it.
  const sortedColumn = sort
    ? columns.find((c) => c.id === sort.columnId)
    : undefined;
  const sorted = sort !== null && sortedColumn !== undefined;

  function statusOf(
    map: Record<TaskStatus, string[]>,
    id: string,
  ): TaskStatus | null {
    if (id.startsWith("section:")) {
      return id.slice("section:".length) as TaskStatus;
    }
    for (const status of STATUS_IDS) {
      if (map[status].includes(id)) return status;
    }
    return null;
  }

  function handleDragStart(e: DragStartEvent) {
    draggingRef.current = true;
    setActiveId(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    if (activeKey === overKey) return;

    setOrder((prev) => {
      const from = statusOf(prev, activeKey);
      const to = statusOf(prev, overKey);
      if (!from || !to) return prev;

      if (from === to) {
        // Reordering inside a group is meaningless under a sort — the sort
        // would immediately overwrite it — so ClickUp turns it off there.
        if (sorted) return prev;
        const oldIndex = prev[from].indexOf(activeKey);
        const newIndex = prev[to].indexOf(overKey);
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev;
        return { ...prev, [from]: arrayMove(prev[from], oldIndex, newIndex) };
      }

      // Cross-group: allowed in both modes, because it is a status change.
      const nextFrom = prev[from].filter((id) => id !== activeKey);
      const overIndex = prev[to].indexOf(overKey);
      const nextTo = [...prev[to]];
      nextTo.splice(overIndex < 0 ? nextTo.length : overIndex, 0, activeKey);
      return { ...prev, [from]: nextFrom, [to]: nextTo };
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    draggingRef.current = false;
    setActiveId(null);
    const activeKey = String(e.active.id);

    const status = statusOf(order, activeKey);
    if (!status) {
      setOrder(buildOrder(grouped));
      return;
    }
    const task = byId.get(activeKey);
    if (!task) return;

    const list = order[status];
    const index = list.indexOf(activeKey);
    const before = index > 0 ? byId.get(list[index - 1]!)?.position ?? null : null;
    const after =
      index < list.length - 1
        ? (byId.get(list[index + 1]!)?.position ?? null)
        : null;

    // Under a sort the visual neighbours aren't position-ordered, so the drop
    // index means nothing — only the status change is real. Keep the task's
    // own position rather than deriving a meaningless one from them.
    const position = sorted ? task.position : computePosition(before, after);

    if (status === task.status && (sorted || position === task.position)) {
      setOrder(buildOrder(grouped));
      return;
    }

    void moveTask({ taskId: activeKey, status, position }).then((res) => {
      if ("error" in res) {
        toast.error(res.error);
        setOrder(buildOrder(grouped));
      } else {
        onChanged();
      }
    });
  }

  /* ── Column operations ────────────────────────────────────────────────── */
  function addColumn(id: string) {
    persist({ columns: [...stored, newColumnEntry(id)], sort });
  }

  function hideColumn(id: string) {
    persist({
      columns: stored.filter((c) => c.id !== id),
      // A hidden column can't stay the sort — nothing would explain the order.
      sort: sort?.columnId === id ? null : sort,
    });
  }

  function moveColumn(id: string, to: "start" | "end") {
    const rest = stored.filter((c) => c.id !== id);
    const entry = stored.find((c) => c.id === id);
    if (!entry) return;
    persist({
      columns: to === "start" ? [entry, ...rest] : [...rest, entry],
      sort,
    });
  }

  function reorderColumns(activeId: string, overId: string) {
    const from = stored.findIndex((c) => c.id === activeId);
    const to = stored.findIndex((c) => c.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    persist({ columns: arrayMove(stored, from, to), sort });
  }

  function resizeColumn(id: string, width: number) {
    // clientX is fractional under browser zoom / fractional DPI, and the
    // layout schema requires integer widths — a fractional width failed the
    // whole save while the optimistic cache kept it, a lie until reload.
    const rounded = Math.round(width);
    persist({
      columns: stored.map((c) => (c.id === id ? { ...c, width: rounded } : c)),
      sort,
    });
  }

  function setSort(columnId: string, dir: "asc" | "desc" | null) {
    persist({ columns: stored, sort: dir ? { columnId, dir } : null });
  }

  function setCalc(columnId: string, calc: ColumnCalc | null) {
    persist({
      columns: stored.map((c) =>
        c.id === columnId ? { ...c, calc: calc ?? undefined } : c,
      ),
      sort,
    });
  }

  /* ── Layout metrics ───────────────────────────────────────────────────── */
  const gridTemplate = useMemo(
    () =>
      [
        `${LEAD_WIDTH}px`,
        `minmax(${TITLE_MIN}px, 1fr)`,
        ...columns.map((c) => `${c.width}px`),
        `${TRAIL_WIDTH}px`,
      ].join(" "),
    [columns],
  );
  const minWidth =
    LEAD_WIDTH +
    TITLE_MIN +
    columns.reduce((sum, c) => sum + c.width, 0) +
    TRAIL_WIDTH;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sort && sortedColumn ? (
        <SortNotice
          label={sortedColumn.label}
          dir={sort.dir}
          onClear={() => setSort(sort.columnId, null)}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div style={{ minWidth }} className="flex flex-1 flex-col">
          <HeaderRow
            propertyId={propertyId}
            columns={columns}
            stored={stored}
            fields={fields}
            sort={sort}
            gridTemplate={gridTemplate}
            onAdd={addColumn}
            onHide={hideColumn}
            onMove={moveColumn}
            onReorder={reorderColumns}
            onResize={resizeColumn}
            onSort={setSort}
            onCalc={setCalc}
          />

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              draggingRef.current = false;
              setActiveId(null);
              setOrder(buildOrder(grouped));
            }}
          >
            {STATUS_IDS.map((status) => {
              if (hideDone && status === "done") return null;
              const col = COLUMNS.find((c) => c.id === status)!;
              const rows = order[status]
                .map((id) => byId.get(id))
                .filter((t): t is Task => Boolean(t));
              return (
                <StatusSection
                  key={status}
                  status={status}
                  itemIds={order[status]}
                  label={col.label}
                  pillClass={COLUMN_PILL_CLASS[col.pillTone].pill}
                  count={rows.length}
                  collapsed={collapsed[status]}
                  onToggleCollapsed={() =>
                    setCollapsed((p) => ({ ...p, [status]: !p[status] }))
                  }
                  onOpenFullCreate={() => onOpenFullCreate(status)}
                >
                  {rows.map((task) => {
                    const children = childrenByParent?.get(task.id) ?? [];
                    const isExpanded = expanded.has(task.id);
                    return (
                      <div key={task.id}>
                        <ListRow
                          propertyId={propertyId}
                          task={task}
                          columns={columns}
                          gridTemplate={gridTemplate}
                          ctx={cellCtx}
                          grouped={grouped}
                          onChanged={onChanged}
                          selected={activeSelection.has(task.id)}
                          selectionActive={activeSelection.size > 0}
                          onToggleSelected={() => toggleSelected(task.id)}
                          subtaskCount={children.length}
                          subtasksExpanded={isExpanded}
                          onToggleSubtasks={() => toggleExpanded(task.id)}
                          sortable
                        />
                        {isExpanded
                          ? children.map((child) => (
                              <ListRow
                                key={child.id}
                                propertyId={propertyId}
                                task={child}
                                columns={columns}
                                gridTemplate={gridTemplate}
                                ctx={cellCtx}
                                grouped={grouped}
                                onChanged={onChanged}
                                selected={activeSelection.has(child.id)}
                                selectionActive={activeSelection.size > 0}
                                onToggleSelected={() => toggleSelected(child.id)}
                                indent
                              />
                            ))
                          : null}
                      </div>
                    );
                  })}
                </StatusSection>
              );
            })}

            <PortalDragOverlay>
              {activeId ? (
                <div className="rounded-md bg-popover px-3 py-1.5 text-sm font-medium text-foreground shadow-overlay">
                  {byId.get(activeId)?.title ?? ""}
                </div>
              ) : null}
            </PortalDragOverlay>
          </DndContext>

          {columns.some((c) => c.calc) ? (
            <CalcFooterRow
              columns={columns}
              tasks={tasks}
              sortCtx={sortCtx}
              gridTemplate={gridTemplate}
            />
          ) : null}
        </div>
      </div>

      {activeSelection.size > 0 ? (
        <BulkActionBar
          propertyId={propertyId}
          ids={[...activeSelection]}
          onDone={() => {
            setSelected(new Set());
            cellCtx.onChanged();
          }}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
    </div>
  );
}

function buildOrder(
  grouped: Record<TaskStatus, Task[]>,
): Record<TaskStatus, string[]> {
  return {
    todo: grouped.todo.map((t) => t.id),
    in_progress: grouped.in_progress.map((t) => t.id),
    blocked: grouped.blocked.map((t) => t.id),
    done: grouped.done.map((t) => t.id),
  };
}

/* ── Calculation footer ──────────────────────────────────────────────────── */

/**
 * ClickUp's List-view calculation row: one sticky line under the table with
 * each column's chosen aggregate over the VISIBLE (filtered) tasks. Only
 * renders when at least one column has a calc picked.
 */
function CalcFooterRow({
  columns,
  tasks,
  sortCtx,
  gridTemplate,
}: {
  columns: ResolvedColumn[];
  tasks: Task[];
  sortCtx: SortContext;
  gridTemplate: string;
}) {
  return (
    <div
      className="sticky bottom-0 z-20 mt-auto grid h-8 items-center border-t border-border bg-card px-2"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <span />
      <span className="px-1.5 text-xs text-faint-foreground tabular-nums">
        {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
      </span>
      {columns.map((column) => {
        if (!column.calc) return <span key={column.id} />;
        const value = computeColumnCalc(column.calc, column, tasks, sortCtx);
        return (
          <span
            key={column.id}
            className="flex min-w-0 items-baseline gap-1.5 px-1.5"
            title={`${CALC_LABEL[column.calc]} of ${column.label}`}
          >
            <span className="shrink-0 text-xs text-faint-foreground">
              {CALC_LABEL[column.calc]}
            </span>
            <span className="truncate text-sm font-medium text-foreground tabular-nums">
              {value ?? "—"}
            </span>
          </span>
        );
      })}
      <span />
    </div>
  );
}

/* ── Header ──────────────────────────────────────────────────────────────── */

function HeaderRow({
  propertyId,
  columns,
  stored,
  fields,
  sort,
  gridTemplate,
  onAdd,
  onHide,
  onMove,
  onReorder,
  onResize,
  onSort,
  onCalc,
}: {
  propertyId: string;
  columns: ResolvedColumn[];
  stored: TaskViewColumn[];
  fields: CustomFieldRow[];
  sort: TaskViewSort;
  gridTemplate: string;
  onAdd: (id: string) => void;
  onHide: (id: string) => void;
  onMove: (id: string, to: "start" | "end") => void;
  onReorder: (activeId: string, overId: string) => void;
  onResize: (id: string, width: number) => void;
  onSort: (columnId: string, dir: "asc" | "desc" | null) => void;
  onCalc: (columnId: string, calc: ColumnCalc | null) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  return (
    <div
      className="sticky top-0 z-20 grid h-9 items-center border-b border-border bg-card px-2 text-sm/[1.2] font-normal text-muted-foreground"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <span />
      <span className="px-1.5">Title</span>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => {
          const over = e.over;
          if (over) onReorder(String(e.active.id), String(over.id));
        }}
      >
        <SortableContext
          items={columns.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {columns.map((column, i) => (
            <HeaderCell
              key={column.id}
              column={column}
              sort={sort}
              isFirst={i === 0}
              isLast={i === columns.length - 1}
              onSort={(dir) => onSort(column.id, dir)}
              onMove={(to) => onMove(column.id, to)}
              onHide={() => onHide(column.id)}
              onResize={(w) => onResize(column.id, w)}
              onCalc={(calc) => onCalc(column.id, calc)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <span className="flex items-center justify-center">
        <AddColumnButton
          propertyId={propertyId}
          stored={stored}
          fields={fields}
          onAdd={onAdd}
        />
      </span>
    </div>
  );
}

function HeaderCell({
  column,
  sort,
  isFirst,
  isLast,
  onSort,
  onMove,
  onHide,
  onResize,
  onCalc,
}: {
  column: ResolvedColumn;
  sort: TaskViewSort;
  isFirst: boolean;
  isLast: boolean;
  onSort: (dir: "asc" | "desc" | null) => void;
  onMove: (to: "start" | "end") => void;
  onHide: () => void;
  onResize: (width: number) => void;
  onCalc: (calc: ColumnCalc | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useSortable({ id: column.id });
  const active = sort?.columnId === column.id ? sort.dir : null;

  // Resize: pointer capture on the right edge, committed on release so the
  // layout is saved once rather than on every mouse move.
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, width: column.width };
    setDraftWidth(column.width);
  }
  function onPointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (!startRef.current) return;
    const next = Math.max(
      column.minWidth,
      Math.min(800, startRef.current.width + (e.clientX - startRef.current.x)),
    );
    setDraftWidth(next);
  }
  function onPointerUp(e: React.PointerEvent<HTMLSpanElement>) {
    if (!startRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const next = draftWidth;
    startRef.current = null;
    setDraftWidth(null);
    if (next != null && next !== column.width) onResize(next);
  }

  return (
    <span
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        // While resizing, preview the new width on the header cell itself;
        // the grid track follows once committed.
        width: draftWidth ?? undefined,
      }}
      className={cn(
        "group/header relative flex min-w-0 items-center",
        isDragging && "opacity-50",
      )}
    >
      {/*
        The grip is a SEPARATE element from the menu trigger on purpose. With
        the drag listeners on the label, base-ui's menu takes the pointerdown
        and opens before dnd-kit's sensor can start a drag, so the column
        never moves — you just get the menu. A dedicated grip keeps both
        gestures reachable (the menu also offers Move to start / end).
      */}
      <span
        {...attributes}
        {...listeners}
        role="button"
        aria-label={`Reorder ${column.label} column`}
        className="grid size-4 shrink-0 cursor-grab place-items-center rounded text-faint-foreground opacity-0 transition-opacity group-hover/header:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="size-3" />
      </span>
      <span className="flex min-w-0 flex-1 items-center">
        <ColumnHeaderMenu
          column={column}
          sort={sort}
          isFirst={isFirst}
          isLast={isLast}
          onSort={onSort}
          onMove={onMove}
          onHide={onHide}
          onCalc={onCalc}
        >
          <span className="min-w-0 truncate">{column.label}</span>
          {active === "asc" ? (
            <ArrowDownAZ className="size-3 shrink-0 text-foreground" />
          ) : active === "desc" ? (
            <ArrowUpAZ className="size-3 shrink-0 text-foreground" />
          ) : null}
        </ColumnHeaderMenu>
      </span>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.label}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none opacity-0 group-hover/header:opacity-100"
      >
        <span className="mx-auto block h-full w-px bg-border" />
      </span>
    </span>
  );
}

/* ── Sections + rows ─────────────────────────────────────────────────────── */

function StatusSection({
  status,
  itemIds,
  label,
  pillClass,
  count,
  collapsed,
  onToggleCollapsed,
  onOpenFullCreate,
  children,
}: {
  status: TaskStatus;
  itemIds: string[];
  label: string;
  pillClass: string;
  count: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenFullCreate: () => void;
  children: React.ReactNode;
}) {
  // The whole section body is a drop target so a task can be dragged into an
  // empty group (which is a status change, not a reorder).
  const { setNodeRef, isOver } = useDroppable({ id: `section:${status}` });

  return (
    <section className="border-b border-border last:border-0">
      <header className="flex h-9 items-center gap-2 px-4">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
          className="grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
        <h3
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-pill px-1.5 text-sm font-medium whitespace-nowrap",
            pillClass,
          )}
        >
          {label}
        </h3>
        <span className="text-sm tabular-nums text-faint-foreground">
          {count}
        </span>
        <button
          type="button"
          onClick={onOpenFullCreate}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-accent"
        >
          <Plus className="size-3" />
          New
        </button>
      </header>

      {!collapsed ? (
        <div ref={setNodeRef} className={cn(isOver && "bg-accent/40")}>
          {count === 0 ? (
            <div className="px-6 py-4 text-sm text-faint-foreground">
              No tasks in this status.
            </div>
          ) : (
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              {children}
            </SortableContext>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ListRow({
  propertyId,
  task,
  columns,
  gridTemplate,
  ctx,
  grouped,
  onChanged,
  selected,
  selectionActive,
  onToggleSelected,
  subtaskCount = 0,
  subtasksExpanded = false,
  onToggleSubtasks,
  indent = false,
  sortable = false,
}: {
  propertyId: string;
  task: Task;
  columns: ResolvedColumn[];
  gridTemplate: string;
  ctx: CellContext;
  grouped: Record<TaskStatus, Task[]>;
  onChanged: () => void;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelected: () => void;
  subtaskCount?: number;
  subtasksExpanded?: boolean;
  onToggleSubtasks?: () => void;
  indent?: boolean;
  /** Sub-task rows live inside their parent and are never reordered. */
  sortable?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const open = useOpenTask(propertyId);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !sortable });

  function handleTitleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    open(task.id);
  }

  function moveTo(status: TaskStatus) {
    if (status === task.status) return;
    const topPos = grouped[status][0]?.position ?? null;
    const position = computePosition(null, topPos);
    startTransition(async () => {
      const result = await moveTask({ taskId: task.id, status, position });
      if ("error" in result) toast.error(result.error);
      else onChanged();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Task deleted");
        onChanged();
      }
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        gridTemplateColumns: gridTemplate,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        // The measured 37px database row (notion-spec-v2 §6); the only rule
        // is the 1px warm divider between rows.
        "group grid min-h-[37px] items-center border-t border-border px-2 py-1 text-sm",
        "hover:bg-accent",
        selected && "bg-accent-pressed",
        (pending || isDragging) && "opacity-60",
      )}
    >
      <span className="flex items-center">
        {sortable ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${task.title}`}
            className="grid size-5 shrink-0 cursor-grab place-items-center rounded-md text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label={selected ? "Deselect task" : "Select task"}
          className={cn(
            "transition-opacity",
            selected || selectionActive
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        />
      </span>

      <span className={cn("flex min-w-0 items-center gap-1.5 px-1.5", indent && "pl-7")}>
        {subtaskCount > 0 && onToggleSubtasks ? (
          <button
            type="button"
            onClick={onToggleSubtasks}
            aria-label={
              subtasksExpanded ? "Collapse sub-tasks" : "Expand sub-tasks"
            }
            className="flex shrink-0 items-center gap-0.5 rounded-md px-0.5 text-muted-foreground hover:bg-accent"
          >
            {subtasksExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span className="text-xs tabular-nums">{subtaskCount}</span>
          </button>
        ) : null}
        <Link
          href={taskHref(propertyId, task.id)}
          onClick={handleTitleClick}
          className={cn(
            "truncate font-medium text-foreground hover:underline",
            indent && "text-sm font-normal",
          )}
        >
          {task.title}
        </Link>
      </span>

      {columns.map((column) => (
        <span key={column.id} className="flex min-w-0 items-center">
          <ListCell column={column} task={task} ctx={ctx} disabled={pending} />
        </span>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              disabled={pending}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuItem
                key={c.id}
                disabled={c.id === task.status}
                onClick={() => moveTo(c.id)}
              >
                <StatusIcon status={c.id} className="size-3.5" />
                {c.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={remove}
              className="text-destructive focus:text-destructive"
            >
              Delete task
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ── Bulk actions ────────────────────────────────────────────────────────── */

/**
 * Floating bulk-action bar (bottom center) — move / prioritize / set a custom
 * field / tag / delete every selected task. Actions run per task through the
 * existing single-task server actions, so each one fires its own automations;
 * partial failures surface once.
 */
function BulkActionBar({
  propertyId,
  ids,
  onDone,
  onClear,
}: {
  propertyId: string;
  ids: string[];
  onDone: () => void;
  onClear: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function runAll(
    fn: (id: string) => Promise<{ error?: string } | { ok: true }>,
    label: string,
  ) {
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => fn(id)));
      const failed = results.filter((r) => "error" in r && r.error).length;
      if (failed > 0)
        toast.error(`${label} failed for ${failed} of ${ids.length}`);
      else
        toast.success(
          `${label} — ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`,
        );
      onDone();
    });
  }

  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1 rounded-overlay bg-popover px-3 py-1.5 shadow-overlay">
        <span className="pr-1 text-xs font-medium tabular-nums text-foreground">
          {ids.length} selected
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={pending}
              />
            }
          >
            Move to
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            {COLUMNS.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() =>
                  runAll(
                    (id) => updateTask({ taskId: id, status: c.id }),
                    `Moved to ${c.label}`,
                  )
                }
              >
                <StatusIcon status={c.id} className="size-3.5" />
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={pending}
              />
            }
          >
            Priority
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            {PRIORITY_IDS.map((pId) => (
              <DropdownMenuItem
                key={pId}
                onClick={() =>
                  runAll(
                    (id) => updateTask({ taskId: id, priority: pId }),
                    `Priority set to ${PRIORITY_META[pId].label}`,
                  )
                }
              >
                <PriorityBars priority={pId} />
                {PRIORITY_META[pId].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <BulkFieldMenus
          propertyId={propertyId}
          ids={ids}
          pending={pending}
          runAll={runAll}
        />

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => runAll((id) => deleteTask(id), "Deleted")}
        >
          Delete
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-faint-foreground"
          disabled={pending}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
