"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRight,
  ChevronsRight,
  MoreHorizontal,
  Plus,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SortableTaskCard } from "./task-card";
import { InlineAddCard } from "./inline-add-card";
import { StatusIcon } from "./task-icons";
import type { Task } from "./kanban";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { TaskStatus } from "@/lib/db/types";

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
  column: {
    id: TaskStatus;
    label: string;
    dotClass: string;
    wipLimit: number | null;
  };
  taskIds: string[];
  tasksById: Record<string, Task>;
  assignees: Record<string, AssigneeInfo>;
  propertyId: string;
  dragActive: boolean;
  /** Id of the card this user is dragging, if any. */
  activeDragId: string | null;
  /** The card being dragged currently belongs to this column. */
  isDropTarget: boolean;
  /** Whether this column should render its body (false when collapsed). */
  collapsed: boolean;
  onToggleCollapse: (status: TaskStatus) => void;
  /** Map of taskId -> name of a teammate dragging it. */
  remoteDragMap: Map<string, string>;
  onChanged: () => void;
  /** Opens the full modal for this column — for "more options" path. */
  onOpenFullCreate: (status: TaskStatus) => void;
  /** Active team scope (`?space=`), threaded to inline quick-add. */
  scopeSpaceId?: string | null;
};

export function KanbanColumn({
  column,
  taskIds,
  tasksById,
  assignees,
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
}: Props) {
  const router = useRouter();
  const { setNodeRef } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const empty = taskIds.length === 0;

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
    const prefill = {
      trigger: "task.status_changed",
      column: column.id,
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

  if (collapsed) {
    return (
      <section
        className={cn(
          "flex h-full w-11 shrink-0 flex-col items-center rounded-lg bg-muted/30 py-3 dark:bg-muted/15",
          isDropTarget && "bg-muted/60 ring-1 ring-primary/40",
        )}
      >
        <button
          type="button"
          onClick={() => onToggleCollapse(column.id)}
          aria-label={`Expand ${column.label} column`}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          <ChevronRight className="size-3.5" />
        </button>
        <div className="mt-3 flex flex-col items-center gap-2">
          <StatusIcon status={column.id} />
          <span
            className="text-xs font-medium tracking-tight text-foreground [writing-mode:vertical-rl]"
            style={{ textOrientation: "mixed" }}
          >
            {column.label}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {taskIds.length}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "group/column flex h-full w-72 shrink-0 flex-col rounded-lg bg-muted/30 dark:bg-muted/15",
        "transition-colors",
        isDropTarget && "bg-muted/60 ring-1 ring-primary/40",
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 px-3">
        <StatusIcon status={column.id} />
        <h3 className="text-sm font-medium tracking-tight text-foreground">
          {column.label}
        </h3>
        <span
          className={cn(
            "text-xs tabular-nums tracking-tight",
            overWip
              ? "font-medium text-warning"
              : "text-muted-foreground",
          )}
          title={
            overWip
              ? `Over the recommended limit of ${column.wipLimit}`
              : undefined
          }
        >
          {taskIds.length}
          {column.wipLimit != null ? (
            <span className="text-muted-foreground/50">/{column.wipLimit}</span>
          ) : null}
        </span>

        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/column:opacity-100 focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${column.label} column options`}
                  className="size-6 text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
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
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Add task to ${column.label}`}
            onClick={() => setAdding(true)}
            className="size-6 text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </header>

      <div
        ref={setScrollRefs}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2"
      >
        {adding ? (
          <InlineAddCard
            propertyId={propertyId}
            status={column.id}
            onCreated={onChanged}
            onClose={() => setAdding(false)}
            scopeSpaceId={scopeSpaceId}
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
                dragActive={dragActive}
                draggedByName={remoteDragMap.get(id) ?? null}
                onChanged={onChanged}
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
            className="shrink-0 rounded-md py-2 text-center text-xs text-muted-foreground/70 hover:text-foreground"
          >
            {taskIds.length - visibleIds.length} more…
          </button>
        ) : null}

        {empty && !adding && isDropTarget ? (
          <div className="mt-2 flex items-center justify-center rounded-md border border-dashed border-primary/40 px-3 py-5 text-center">
            <p className="text-xs text-muted-foreground">Drop here</p>
          </div>
        ) : null}

        {/* Footer add — a full-width pill anchored at the bottom of the
            column's scroll area, matching Linear's resting CTA. Always
            visible (empty or not) so adding feels one click away. */}
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={`Add task to ${column.label}`}
            className={cn(
              "mt-0.5 flex h-9 w-full items-center justify-center rounded-md",
              "border border-border/60 bg-transparent",
              "text-muted-foreground/70 transition-colors",
              "hover:border-border hover:bg-foreground/5 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </div>

      {/* "More options" — opens the full dialog with description, priority,
          and assignee fields. Visually subtle so it doesn't compete with the
          inline add. */}
      {adding ? (
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            onOpenFullCreate(column.id);
          }}
          className="mx-2 mb-2 inline-flex h-6 items-center gap-1.5 self-start rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Sparkles className="size-3" />
          Need more options? Open full editor
        </button>
      ) : null}
    </section>
  );
}

