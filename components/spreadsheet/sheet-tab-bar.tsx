"use client";

/**
 * Sheet tabs at the bottom of the workbook. Click switches the active sheet;
 * double-click renames; right-click opens a context menu with rename /
 * duplicate / change color / delete. The "+" button on the right adds a new
 * sheet. Drag-to-reorder via dnd-kit.
 *
 * Active-sheet state has TWO copies:
 *   - `localActiveSheetId` (in `SheetSurface`) is *this user's* current view.
 *   - `workbook.activeSheetId` is "last viewer" — drives the default tab a
 *     new joiner lands on.
 *
 * Switching sheets only changes the local state by default; workbook
 * `activeSheetId` is updated as a courtesy so a freshly-joined collaborator
 * sees the last-active sheet. Other users on different sheets see your
 * selection disappear from their grid via the `activeSheetId` filter in
 * `sheet-surface.tsx`.
 */

import { useEffect, useRef, useState } from "react";
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
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Plus } from "lucide-react";
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
import { cn } from "@/lib/utils";

const TAB_COLORS = [
  null, // reset
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

export type SheetTabSummary = {
  id: string;
  title: string;
  color?: string;
};

export function SheetTabBar({
  sheets,
  activeSheetId,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
  onSetColor,
  /** Map of sheetId → list of other-user labels currently viewing it. */
  viewersBySheet,
}: {
  sheets: ReadonlyArray<SheetTabSummary>;
  activeSheetId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onSetColor: (id: string, color: string | null) => void;
  viewersBySheet?: Map<string, Array<{ name: string; color: string }>>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = sheets.findIndex((s) => s.id === String(active.id));
    const to = sheets.findIndex((s) => s.id === String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(from, to);
  }

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-border/60 bg-muted/30 px-2 py-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        title="New sheet"
        onClick={onAdd}
        className="size-7"
      >
        <Plus className="size-4" />
      </Button>
      <span className="mr-1 h-5 w-px bg-border/70" />
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sheets.map((s) => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {sheets.map((sheet) => (
              <SheetTab
                key={sheet.id}
                sheet={sheet}
                active={sheet.id === activeSheetId}
                viewers={viewersBySheet?.get(sheet.id) ?? []}
                canDelete={sheets.length > 1}
                onSelect={onSelect}
                onRename={onRename}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onSetColor={onSetColor}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SheetTab({
  sheet,
  active,
  viewers,
  canDelete,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
  onSetColor,
}: {
  sheet: SheetTabSummary;
  active: boolean;
  viewers: Array<{ name: string; color: string }>;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSetColor: (id: string, color: string | null) => void;
}) {
  const sortable = useSortable({ id: sheet.id });
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  function commitRename(value: string) {
    setEditing(false);
    const next = value.trim();
    if (next && next !== sheet.title) onRename(sheet.id, next);
  }

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "group relative flex shrink-0 items-center gap-1 rounded-t-md border-x border-t border-transparent px-2 py-1 text-[12.5px] transition-colors",
        active
          ? "border-border/60 bg-background text-foreground shadow-[0_-1px_0_0_var(--background)]"
          : "text-muted-foreground hover:bg-muted",
        sortable.isDragging && "opacity-50",
      )}
      onClick={() => !editing && onSelect(sheet.id)}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      {sheet.color ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: sheet.color }}
        />
      ) : null}
      {editing ? (
        <input
          ref={inputRef}
          defaultValue={sheet.title}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={(e) => commitRename(e.currentTarget.value)}
          className="w-[120px] bg-transparent outline-none"
          maxLength={60}
        />
      ) : (
        <span
          className="cursor-pointer"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {sheet.title}
        </span>
      )}
      {viewers.length > 0 ? (
        <span className="ml-1 flex -space-x-1">
          {viewers.slice(0, 3).map((v, i) => (
            <span
              key={i}
              title={v.name}
              className="size-2 rounded-full ring-2 ring-background"
              style={{ background: v.color }}
            />
          ))}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="ml-1 rounded p-0.5 opacity-50 hover:bg-muted hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Sheet actions"
            >
              <ChevronDown className="size-3" />
            </button>
          }
        />
        <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDuplicate(sheet.id)}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Color</DropdownMenuLabel>
          </DropdownMenuGroup>
          <div className="grid grid-cols-9 gap-1 p-1">
            {TAB_COLORS.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSetColor(sheet.id, c)}
                title={c ?? "None"}
                className={cn(
                  "size-5 rounded-sm border border-border/60 transition-shadow hover:ring-2 hover:ring-foreground/15",
                  sheet.color === c && "ring-2 ring-foreground/40",
                )}
                style={{ background: c ?? "transparent" }}
              />
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(sheet.id)}
            disabled={!canDelete}
            className="text-destructive focus:text-destructive"
          >
            Delete sheet
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
