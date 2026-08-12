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
import { COLUMN_PILL_CLASS, type Task } from "./kanban";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { CustomFieldOption, TaskStatus } from "@/lib/db/types";

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
    pillTone: keyof typeof COLUMN_PILL_CLASS;
    wipLimit: number | null;
  };
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
  const hue = COLUMN_PILL_CLASS[column.pillTone];

  if (collapsed) {
    return (
      // No column background (notion-spec-v2 §6) — a collapsed group is just
      // its pill turned sideways. The drop target is signalled by the warm
      // pressed fill alone; no ring, no stroke.
      <section
        className={cn(
          "flex h-full w-11 shrink-0 flex-col items-center rounded-md py-3 transition-colors",
          isDropTarget && "bg-accent-pressed",
        )}
      >
        <button
          type="button"
          onClick={() => onToggleCollapse(column.id)}
          aria-label={`Expand ${column.label} column`}
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-3.5" />
        </button>
        <div className="mt-3 flex flex-col items-center gap-2">
          <span
            className={cn(
              "rounded-pill px-1 py-1.5 text-sm font-medium [writing-mode:vertical-rl]",
              hue.pill,
            )}
            style={{ textOrientation: "mixed" }}
          >
            {column.label}
          </span>
          <span className="text-sm tabular-nums text-faint-foreground">
            {taskIds.length}
          </span>
        </div>
      </section>
    );
  }

  return (
    // **No column background.** Notion's board groups float their cards on the
    // page plane; the grey well we used to paint here is the single loudest
    // "generic kanban" tell (notion-spec-v2 §1.4/§6). The only fill this
    // element ever takes is the transient drop-target wash.
    <section
      className={cn(
        "group/column flex h-full w-72 shrink-0 flex-col rounded-md",
        "transition-colors",
        isDropTarget && "bg-accent-pressed",
      )}
    >
      {/* Group header = a tinted status PILL + a faint count. No icon glyph,
          no primary-ink heading — the hue carries the state. */}
      <header className="flex h-10 shrink-0 items-center gap-2 px-2">
        <h3
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-pill px-1.5 text-sm font-medium whitespace-nowrap",
            hue.pill,
          )}
        >
          {column.label}
        </h3>
        <span
          className={cn(
            "text-sm tabular-nums",
            overWip ? "font-medium text-warning" : "text-faint-foreground",
          )}
          title={
            overWip
              ? `Over the recommended limit of ${column.wipLimit}`
              : undefined
          }
        >
          {taskIds.length}
          {column.wipLimit != null ? (
            <span className="text-faint-foreground">/{column.wipLimit}</span>
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
                  className="size-6 text-muted-foreground hover:bg-accent"
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
            className="size-6 text-muted-foreground hover:bg-accent"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </header>

      <div
        ref={setScrollRefs}
        // BLOCK layout, not flex — load-bearing. Chrome ignores
        // `contain-intrinsic-size` for a `content-visibility: auto` element
        // that is a FLEX ITEM: the flex algorithm resolves the item's main
        // size from its (skipped, therefore empty) content, so every
        // offscreen card collapsed to 26px of padding and the column's
        // scrollHeight was ~40% of the truth. Same markup in a block
        // container reserves the full size correctly (verified side by side:
        // block scrollHeight 7280 vs flex 1280 for identical children).
        // Cards feed dnd-kit's droppable rects, and dnd-kit measures those
        // once per drag — collapsed rects meant drops landed nowhere near
        // the cursor. `space-y-1.5` replaces the old `gap-1.5`.
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2"
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
                labels={cardLabels[id]}
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
            className="block w-full rounded-md py-2 text-center text-sm text-faint-foreground hover:text-foreground"
          >
            {taskIds.length - visibleIds.length} more…
          </button>
        ) : null}

        {empty && !adding && isDropTarget ? (
          <div className="mt-2 flex items-center justify-center rounded-md bg-accent px-3 py-5 text-center">
            <p className="text-xs text-faint-foreground">Drop here</p>
          </div>
        ) : null}

        {/* Notion's inline "+ New page" row (notion-spec-v2 §6): always
            visible, LABELLED, no fill at rest, and its hover wash is the
            column's own hue. Not a filled grey pill with a bare glyph — that
            read as a button parked in a well. */}
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              "mt-0.5 flex h-7 w-full items-center gap-1.5 rounded-md px-1.5",
              "text-sm transition-colors",
              hue.add,
              "focus-visible:shadow-focus focus-visible:outline-none",
            )}
          >
            <Plus className="size-3.5 shrink-0" />
            New task
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

