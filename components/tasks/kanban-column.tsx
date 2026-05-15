"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SortableTaskCard } from "./task-card";
import type { Task } from "./kanban";
import type { TaskStatus } from "@/lib/db/types";

type Props = {
  column: { id: TaskStatus; label: string; dotClass: string };
  taskIds: string[];
  tasksById: Record<string, Task>;
  propertyId: string;
  dragActive: boolean;
  /** The card being dragged currently belongs to this column. */
  isDropTarget: boolean;
  /** Map of taskId -> name of a teammate dragging it. */
  remoteDragMap: Map<string, string>;
  onMove: (taskId: string, status: TaskStatus) => void;
  onChanged: () => void;
  onAddCard: (status: TaskStatus) => void;
};

export function KanbanColumn({
  column,
  taskIds,
  tasksById,
  propertyId,
  dragActive,
  isDropTarget,
  remoteDragMap,
  onMove,
  onChanged,
  onAddCard,
}: Props) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const empty = taskIds.length === 0;

  return (
    <section
      className={cn(
        "flex w-80 shrink-0 flex-col rounded-xl border border-border bg-muted/40",
        isDropTarget && "border-primary/30 bg-muted/70 ring-2 ring-primary/15",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn("size-2 rounded-full", column.dotClass)} />
        <h3 className="text-sm font-semibold text-foreground">
          {column.label}
        </h3>
        <span className="rounded-full bg-foreground/8 px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
          {taskIds.length}
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Add task to ${column.label}`}
          onClick={() => onAddCard(column.id)}
          className="ml-auto size-6 text-muted-foreground"
        >
          <Plus className="size-4" />
        </Button>
      </header>

      <div
        ref={setNodeRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0"
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {taskIds.map((id) => {
            const task = tasksById[id];
            if (!task) return null;
            return (
              <SortableTaskCard
                key={id}
                propertyId={propertyId}
                task={task}
                dragActive={dragActive}
                draggedByName={remoteDragMap.get(id) ?? null}
                onMove={onMove}
                onChanged={onChanged}
              />
            );
          })}
        </SortableContext>

        {empty ? (
          <div
            className={cn(
              "flex flex-1 items-center justify-center rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground",
              isDropTarget && "border-primary/40 text-foreground",
            )}
          >
            {isDropTarget ? "Drop here" : "No tasks"}
          </div>
        ) : null}
      </div>
    </section>
  );
}
