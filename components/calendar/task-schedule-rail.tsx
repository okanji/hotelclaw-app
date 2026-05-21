"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CircleDashed, X } from "lucide-react";
import { toast } from "sonner";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { unscheduleTask } from "@/lib/calendar/actions";
import { cn } from "@/lib/utils";
import { PRIORITY_META } from "@/components/tasks/kanban";

/**
 * Rail of unscheduled tasks (those with no scheduled_start) — drag a chip
 * from here onto a day column to schedule it. Lives between the calendar
 * grid and the team-overlay panel.
 *
 * Reads from the shared `["tasks", propertyId]` cache so the chip list
 * stays consistent with the kanban board. The board already has its own
 * dnd-kit drop targets, so we use a distinct draggable `id` namespace
 * (`task-rail:<id>`) — the board's onDragEnd ignores ids that aren't its
 * own column targets.
 */
export function TaskScheduleRail({ propertyId }: { propertyId: string }) {
  const tasksQuery = useQuery(tasksQueryOptions(propertyId));
  const qc = useQueryClient();

  // Tasks without a scheduled window. We don't have the field on the
  // shared Task type (it's not what the board renders), so cast via the
  // structural shape we know is in the row.
  const unscheduled = useMemo(() => {
    const rows = (tasksQuery.data ?? []) as Array<{
      id: string;
      title: string;
      status: string;
      priority: keyof typeof PRIORITY_META;
      scheduled_start?: string | null;
    }>;
    return rows.filter((t) => !t.scheduled_start && t.status !== "done");
  }, [tasksQuery.data]);

  if (unscheduled.length === 0) return null;

  async function handleUnschedule(taskId: string) {
    const r = await unscheduleTask(propertyId, taskId);
    if ("error" in r) toast.error(r.error);
    else {
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
    }
  }

  return (
    <aside className="hidden w-56 shrink-0 border-l border-border bg-muted/20 lg:flex lg:flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        <CircleDashed className="size-3.5" />
        Unscheduled tasks
      </div>
      <ul className="flex flex-col gap-1 overflow-auto p-1.5">
        {unscheduled.map((task) => (
          <TaskChip
            key={task.id}
            task={task}
            onUnschedule={() => handleUnschedule(task.id)}
          />
        ))}
      </ul>
    </aside>
  );
}

function TaskChip({
  task,
  onUnschedule,
}: {
  task: {
    id: string;
    title: string;
    priority: keyof typeof PRIORITY_META;
  };
  onUnschedule: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `task-rail:${task.id}`,
      data: { kind: "task", taskId: task.id },
    });
  const priorityMeta = PRIORITY_META[task.priority];
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.7 : 1,
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "group flex cursor-grab items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm",
        "hover:border-foreground/30",
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", priorityMeta.dotClass)}
      />
      <span className="line-clamp-2 flex-1 text-foreground/90">
        {task.title}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnschedule();
        }}
        className="opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Hide from rail"
      >
        <X className="size-3 text-muted-foreground" />
      </button>
    </li>
  );
}
