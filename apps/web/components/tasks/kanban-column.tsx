"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Gi } from "@/components/gr8r/icon";
import { G8StatusIcon } from "@/components/gr8r/my-tasks-glyphs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDownWideNarrow,
  CheckCheck,
  ChevronsRight,
  Ellipsis,
  Plus,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { moveTask, updateTask } from "./actions";
import { PRIORITY_META, type Task } from "./kanban";
import { cn } from "@/lib/utils";
import { SortableTaskCard } from "./task-card";
import { InlineAddCard } from "./inline-add-card";
import { isDoneColumn, legacyOf, type ColumnDef } from "@/lib/tasks/statuses";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { CustomFieldOption } from "@/lib/db/types";

/**
 * Cards rendered per column before the scroll sentinel loads the next page.
 * Full boards paint thousands of px of card content per column into Chrome's
 * composited scroller textures, which both costs raster time and trips a
 * macOS GPU-rasterization bug (tiles dropped → cards/header white until a
 * scroll re-rasters). Capping the rendered window keeps the textures small;
 * scrolling near the bottom reveals more (per-column infinite scroll).
 */
const COLUMN_PAGE = 25;

type Props = {
  /** One status of the list's pipeline, or one of the 4 category columns (0114). */
  column: ColumnDef;
  /** Where "Mark all done" sends the column — the board's closed status. */
  doneTarget: string;
  taskIds: string[];
  tasksById: Record<string, Task>;
  assignees: Record<string, AssigneeInfo>;
  /** taskId → label-field chips, resolved board-level. */
  cardLabels: Record<string, CustomFieldOption[]>;
  propertyId: string;
  dragActive: boolean;
  /** Id of the card this user is dragging, if any. */
  activeDragId: string | null;
  /** The card being dragged currently belongs to this column. */
  isDropTarget: boolean;
  /** Whether this column should render its body (false when collapsed). */
  collapsed: boolean;
  onToggleCollapse: (status: string) => void;
  /** Map of taskId -> name of a teammate dragging it. */
  remoteDragMap: Map<string, string>;
  onChanged: () => void;
  /** Opens the full modal for this column — for "more options" path. */
  onOpenFullCreate: (status: string) => void;
  /** Active team scope (`?space=`), threaded to inline quick-add. */
  scopeSpaceId?: string | null;
  /** Active list scope (`?list=`), threaded to inline quick-add. */
  scopeListId?: string | null;
  /** Project scope (the project page's board) — quick-adds join it. */
  scopeProjectId?: string | null;
};

export function KanbanColumn({
  column,
  doneTarget,
  taskIds,
  tasksById,
  assignees,
  cardLabels,
  propertyId,
  dragActive,
  activeDragId,
  isDropTarget,
  collapsed,
  onToggleCollapse,
  remoteDragMap,
  onChanged,
  onOpenFullCreate,
  scopeSpaceId,
  scopeListId,
  scopeProjectId,
}: Props) {
  const router = useRouter();
  const { setNodeRef } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const empty = taskIds.length === 0;

  // Column-level actions (gr8r's column menu): end-of-shift "clear the
  // column" moves, run through the SAME per-task actions as the cards so
  // notifications, recurrence roll-forward and the activity log all fire.
  async function markAllDone() {
    const ids = [...taskIds];
    const results = await Promise.all(
      ids.map((id) => updateTask({ taskId: id, status: doneTarget })),
    );
    const failed = results.filter((r) => "error" in r).length;
    onChanged();
    if (failed) toast.error(`${failed} of ${ids.length} tasks could not be completed`);
    else toast.success(`Marked ${ids.length} ${ids.length === 1 ? "task" : "tasks"} done`);
  }
  async function sortByPriority() {
    const ordered = [...taskIds]
      .map((id) => tasksById[id])
      .filter((t): t is Task => Boolean(t))
      .sort(
        (a, b) =>
          PRIORITY_META[b.priority].rank - PRIORITY_META[a.priority].rank ||
          a.position - b.position,
      );
    await Promise.all(
      ordered.map((t, i) =>
        moveTask({ taskId: t.id, status: column.id, position: (i + 1) * 1024 }),
      ),
    );
    onChanged();
    toast.success("Sorted by priority");
  }

  // Windowed rendering — see COLUMN_PAGE. The scroll container doubles as
  // the IntersectionObserver root, so we keep our own ref alongside
  // dnd-kit's droppable ref.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      scrollRef.current = node;
    },
    [setNodeRef],
  );
  const sentinelRef = useRef<HTMLButtonElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(COLUMN_PAGE);
  const hasMore = taskIds.length > visibleCount;

  useEffect(() => {
    if (collapsed || !hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => c + COLUMN_PAGE);
        }
      },
      { root: scrollRef.current, rootMargin: "300px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [collapsed, hasMore]);

  const visibleIds = useMemo(() => {
    const ids = taskIds.slice(0, visibleCount);
    // Keep the in-column preview of this user's dragged card mounted even
    // when drag-over inserts it beyond the rendered window — otherwise the
    // dimmed placeholder vanishes mid-drag.
    if (
      activeDragId &&
      taskIds.includes(activeDragId) &&
      !ids.includes(activeDragId)
    ) {
      ids.push(activeDragId);
    }
    return ids;
  }, [taskIds, visibleCount, activeDragId]);

  function automateColumn() {
    // The workflow trigger filters on the legacy literal (`trigger.to`), so
    // a pipeline column hands over its category's literal, not its uuid.
    const prefill = {
      trigger: "task.status_changed",
      column: legacyOf({ category: column.category, is_blocked: column.isBlocked }),
      column_label: column.label,
    };
    const goal = `When a task moves to ${column.label}`;
    const url = `/p/${propertyId}/workflows/new?prefill=${encodeURIComponent(
      btoa(JSON.stringify({ goal, ...prefill })),
    )}`;
    router.push(url);
  }
  const overWip =
    column.wipLimit != null && taskIds.length > column.wipLimit;
  const finished = isDoneColumn(column);
  const glyph = (
    <G8StatusIcon
      category={column.category}
      blocked={column.isBlocked}
      color={column.color}
    />
  );

  if (collapsed) {
    // gr8r `.bcol.collapsed`: the glyph + the name turned sideways. Still a
    // droppable — `.over` washes it while a card hovers.
    return (
      <div
        ref={setNodeRef}
        className={cn("bcol collapsed", isDropTarget && "over")}
        role="button"
        tabIndex={0}
        aria-label={`Expand ${column.label}`}
        title="Expand"
        onClick={() => onToggleCollapse(column.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapse(column.id);
          }
        }}
      >
        {glyph}
        <span className="vname">
          {column.label}
          <span className="faint">{taskIds.length}</span>
        </span>
      </div>
    );
  }

  return (
    // gr8r `.bcol` (src/views/board.js): sunken column, `.bcol-h` header
    // (glyph · name · count · hover acts), `.bcol-b` card stack, `.addcard`.
    <section
      className={cn("bcol", isDropTarget && "over")}
      aria-label={column.label}
    >
      <div className="bcol-h">
        {glyph}
        <span className="truncate">{column.label}</span>
        <span
          className="cnt num"
          style={overWip ? { color: "var(--g8-amber)" } : undefined}
          title={
            overWip
              ? `Over the recommended limit of ${column.wipLimit}`
              : undefined
          }
        >
          {taskIds.length}
          {column.wipLimit != null ? `/${column.wipLimit}` : null}
        </span>

        <span className="acts">
          <button
            type="button"
            className="ibtn ibtn-xs"
            aria-label={`Add task to ${column.label}`}
            title="Add task"
            onClick={() => setAdding(true)}
          >
            <Gi icon={Plus} size={14} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="ibtn ibtn-xs"
                  aria-label={`${column.label} column options`}
                />
              }
            >
              <Gi icon={Ellipsis} size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onToggleCollapse(column.id)}>
                <ChevronsRight className="size-3.5" />
                Collapse column
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenFullCreate(column.id)}>
                <Sparkles className="size-3.5" />
                New task with details…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={automateColumn}>
                <Workflow className="size-3.5" />
                Automate this column…
              </DropdownMenuItem>
              {!finished && taskIds.length > 0 ? (
                <DropdownMenuItem onClick={markAllDone}>
                  <CheckCheck className="size-3.5" />
                  Mark all done
                </DropdownMenuItem>
              ) : null}
              {taskIds.length > 1 ? (
                <DropdownMenuItem onClick={sortByPriority}>
                  <ArrowDownWideNarrow className="size-3.5" />
                  Sort by priority
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <div
        ref={setScrollRefs}
        // `.bcol-b` with `is-block` (gr8r-ext.css): BLOCK layout, not flex —
        // load-bearing. Chrome ignores `contain-intrinsic-size` for a
        // `content-visibility: auto` element that is a FLEX ITEM, so every
        // offscreen card collapsed to its padding and dnd-kit measured drop
        // rects nowhere near the cursor. Siblings are spaced by margin.
        className="bcol-b is-block"
      >
        {adding ? (
          <InlineAddCard
            propertyId={propertyId}
            status={column.id}
            onCreated={onChanged}
            onClose={() => setAdding(false)}
            onOpenFullCreate={() => {
              setAdding(false);
              onOpenFullCreate(column.id);
            }}
            scopeSpaceId={scopeSpaceId}
            scopeListId={scopeListId}
            scopeProjectId={scopeProjectId}
          />
        ) : null}

        <SortableContext
          items={visibleIds}
          strategy={verticalListSortingStrategy}
        >
          {visibleIds.map((id) => {
            const task = tasksById[id];
            if (!task) return null;
            const info = task.assignee_id
              ? assignees[task.assignee_id]
              : undefined;
            return (
              <SortableTaskCard
                key={id}
                propertyId={propertyId}
                task={task}
                assignee={info}
                labels={cardLabels[id]}
                dragActive={dragActive}
                draggedByName={remoteDragMap.get(id) ?? null}
                onChanged={onChanged}
                doneTarget={doneTarget}
              />
            );
          })}
        </SortableContext>

        {hasMore ? (
          // Scroll sentinel — auto-loads the next page as it nears the
          // viewport; clickable as a fallback.
          <button
            type="button"
            ref={sentinelRef}
            onClick={() => setVisibleCount((c) => c + COLUMN_PAGE)}
            className="addcard"
            style={{ justifyContent: "center" }}
          >
            {taskIds.length - visibleIds.length} more…
          </button>
        ) : null}

        {empty && !adding && isDropTarget ? (
          <div className="empty-state sm">
            <p>Drop here</p>
          </div>
        ) : null}

        {!adding ? (
          <button
            type="button"
            className="addcard"
            onClick={() => setAdding(true)}
          >
            <Gi icon={Plus} size={14} />
            Add task
          </button>
        ) : null}
      </div>
    </section>
  );
}
