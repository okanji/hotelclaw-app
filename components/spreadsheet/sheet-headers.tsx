"use client";

/**
 * Header building blocks. Two pieces:
 *
 *   1. `<HeadersDnd>` — the dnd-kit + SortableContext wrapper. Mounts ONCE
 *      around the part of the table that contains the items it sorts (the
 *      `<thead>` for columns, the `<tbody>` for rows). The parent feeds it
 *      the ordered list of item ids and an `onMove(from, to)` callback.
 *
 *   2. `<ColumnHandle>` / `<RowHandle>` — the inner control that lives
 *      inside each `<th>`. Uses `useSortable` for the drag handle + transform,
 *      `useDrag` from @use-gesture/react for the resize handle, and a Radix
 *      DropdownMenu for insert-before/insert-after/delete actions.
 *
 * Separating them this way keeps the table semantically valid (each column
 * has its own `<th>`) while only mounting one DnD context per axis.
 */

import { useRef, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDrag } from "@use-gesture/react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  ROW_MAX_HEIGHT,
  ROW_MIN_HEIGHT,
} from "@/lib/spreadsheet/constants";
import {
  getColumnLabel,
  getRowLabel,
} from "@/lib/spreadsheet/formula/utils";

/**
 * Wraps a slice of the table in a dnd-kit context + SortableContext. Use it
 * around the `<thead>` row (`axis="column"`) and around the `<tbody>`
 * (`axis="row"`). The `ids` MUST be in the order the items appear so reorder
 * indices map correctly back to LiveList positions.
 */
export function HeadersDnd({
  axis,
  ids,
  onMove,
  children,
}: {
  axis: "column" | "row";
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onMove(from, to);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      modifiers={[
        restrictToParentElement,
        axis === "column" ? restrictToHorizontalAxis : restrictToVerticalAxis,
      ]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={ids}
        strategy={
          axis === "column"
            ? horizontalListSortingStrategy
            : verticalListSortingStrategy
        }
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export type HeaderHandleProps = {
  id: string;
  index: number;
  size: number;
  count: number;
  onResize: (index: number, size: number) => void;
  onInsertBefore: (index: number) => void;
  onInsertAfter: (index: number) => void;
  onDelete: (index: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  /** Click anywhere on the header (not the menu, not the resize handle) selects the whole axis. */
  onSelectAxis?: (index: number, shiftKey: boolean) => void;
  /** Only for column headers: sort the column. */
  onSort?: (index: number, direction: "asc" | "desc") => void;
};

/** Inner content for a column `<th>`. Provides drag, resize, and the menu. */
export function ColumnHandle(props: HeaderHandleProps) {
  return <Handle {...props} axis="column" />;
}

/** Inner content for a row `<th>`. Same shape as `ColumnHandle`. */
export function RowHandle(props: HeaderHandleProps) {
  return <Handle {...props} axis="row" />;
}

function Handle({
  axis,
  id,
  index,
  size,
  count,
  onResize,
  onResizeStart,
  onResizeEnd,
  onInsertBefore,
  onInsertAfter,
  onDelete,
  onSelectAxis,
  onSort,
}: HeaderHandleProps & { axis: "column" | "row" }) {
  const sortable = useSortable({ id });
  const startSize = useRef(size);

  const bindResize = useDrag(
    ({ first, last, movement: [mx, my] }) => {
      if (first) {
        startSize.current = size;
        onResizeStart?.();
      }
      const delta = axis === "column" ? mx : my;
      const next =
        axis === "column"
          ? clamp(startSize.current + delta, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH)
          : clamp(startSize.current + delta, ROW_MIN_HEIGHT, ROW_MAX_HEIGHT);
      onResize(index, next);
      if (last) onResizeEnd?.();
    },
    { axis: axis === "column" ? "x" : "y" },
  );

  const style: CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  const label = axis === "column" ? getColumnLabel(index) : getRowLabel(index);

  // Click-without-drag on the header surface selects the whole axis.
  // dnd-kit's PointerSensor uses `activationConstraint.distance: 4`, so a
  // pointerdown + pointerup with <4px movement never starts a drag — and
  // because dnd-kit doesn't suppress the synthetic click in that path, an
  // `onClick` handler on this same element fires for clicks but not drags.
  function handleClick(e: React.MouseEvent) {
    onSelectAxis?.(index, e.shiftKey);
  }

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={
        (axis === "column"
          ? "hc-sheet-col-header-inner"
          : "hc-sheet-row-header-inner") +
        (sortable.isDragging ? " hc-sheet-header-dragging" : "")
      }
      {...sortable.attributes}
      {...sortable.listeners}
      onClick={handleClick}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-1 px-1 py-0.5"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <span>{label}</span>
              <ChevronDown className="size-3 opacity-60" />
            </button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => onInsertBefore(index)}>
            Insert {axis === "column" ? "column left" : "row above"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onInsertAfter(index)}>
            Insert {axis === "column" ? "column right" : "row below"}
          </DropdownMenuItem>
          {onSort ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSort(index, "asc")}>
                Sort A → Z
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSort(index, "desc")}>
                Sort Z → A
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onDelete(index)}
            disabled={count <= 1}
            className="text-destructive focus:text-destructive"
          >
            Delete {axis === "column" ? "column" : "row"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div
        {...bindResize()}
        onPointerDown={(e) => e.stopPropagation()}
        className={
          axis === "column" ? "hc-sheet-col-resize" : "hc-sheet-row-resize"
        }
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
