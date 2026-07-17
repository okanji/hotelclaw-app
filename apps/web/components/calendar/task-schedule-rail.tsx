"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDraggable } from "@dnd-kit/core";
import { CircleDashed, GripVertical, X } from "lucide-react";
import { toast } from "sonner";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { unscheduleTask } from "@/lib/calendar/actions";
import { CountBadge } from "@/components/ui/count-badge";
import { cn } from "@/lib/utils";
import { PRIORITY_META } from "@/components/tasks/kanban";

type RailTask = {
  id: string;
  title: string;
  status: string;
  priority: keyof typeof PRIORITY_META;
  scheduled_start?: string | null;
};

/** Drag payload a rail chip carries — the room's DragOverlay renders the
 *  ghost from this, so it needs the display fields, not just the id. */
export type TaskDragData = {
  kind: "task";
  taskId: string;
  title: string;
  priority: keyof typeof PRIORITY_META;
};

/**
 * Ghost chip rendered inside the room's `<DragOverlay>` while a task is
 * being dragged. The overlay portals to the body, so the ghost isn't
 * clipped by the rail's `overflow-auto` the way a transformed `<li>` is.
 */
export function TaskChipGhost({
  title,
  priority,
}: {
  title: string;
  priority: keyof typeof PRIORITY_META;
}) {
  return (
    <div className="flex w-56 cursor-grabbing items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-xs shadow-lg ring-1 ring-foreground/5">
      <span
        className={cn(
          "mt-1 size-1.5 shrink-0 rounded-full",
          PRIORITY_META[priority].dotClass,
        )}
      />
      <span className="line-clamp-2 min-w-0 flex-1 text-foreground/90">
        {title}
      </span>
    </div>
  );
}

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

  // Tasks without a scheduled window, grouped by priority in PRIORITY_META
  // order so urgent work surfaces at the top of the rail. We don't have the
  // scheduling field on the shared Task type (it's not what the board
  // renders), so cast via the structural shape we know is in the row.
  const groups = useMemo(() => {
    const rows = (tasksQuery.data ?? []) as RailTask[];
    const unscheduled = rows.filter(
      (t) => !t.scheduled_start && t.status !== "done",
    );
    const byPriority = new Map<keyof typeof PRIORITY_META, RailTask[]>();
    for (const task of unscheduled) {
      const arr = byPriority.get(task.priority) ?? [];
      arr.push(task);
      byPriority.set(task.priority, arr);
    }
    return (
      Object.entries(PRIORITY_META) as Array<
        [keyof typeof PRIORITY_META, (typeof PRIORITY_META)[keyof typeof PRIORITY_META]]
      >
    )
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([key, meta]) => ({ key, meta, tasks: byPriority.get(key) ?? [] }))
      .filter((g) => g.tasks.length > 0);
  }, [tasksQuery.data]);

  const total = useMemo(
    () => groups.reduce((n, g) => n + g.tasks.length, 0),
    [groups],
  );

  if (total === 0) return null;

  async function handleUnschedule(taskId: string) {
    const r = await unscheduleTask(propertyId, taskId);
    if ("error" in r) toast.error(r.error);
    else {
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
    }
  }

  return (
    <aside className="flex min-h-0 w-64 flex-1 shrink-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />
          Unscheduled
        </div>
        <CountBadge>{total}</CountBadge>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="flex flex-col gap-3">
          {groups.map(({ key, meta, tasks }) => (
            <section key={key}>
              <div className="flex items-baseline justify-between px-1 pb-1">
                <span
                  className={cn(
                    "text-xs font-medium uppercase tracking-wide",
                    key === "urgent"
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground",
                  )}
                >
                  {meta.label}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground/70">
                  {tasks.length}
                </span>
              </div>
              <ul role="list" className="flex flex-col gap-1">
                {tasks.map((task) => (
                  <TaskChip
                    key={task.id}
                    task={task}
                    onUnschedule={() => handleUnschedule(task.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        Drag a task onto the grid to schedule it
      </div>
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-rail:${task.id}`,
    data: {
      kind: "task",
      taskId: task.id,
      title: task.title,
      priority: task.priority,
    } satisfies TaskDragData,
  });
  const priorityMeta = PRIORITY_META[task.priority];
  return (
    <li
      ref={setNodeRef}
      // The ghost lives in the room's DragOverlay; the source chip just
      // dims in place so the list doesn't reflow mid-drag.
      style={{ opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className={cn(
        "group flex cursor-grab items-start gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-2 text-xs transition-colors",
        "hover:border-foreground/25 hover:shadow-xs active:cursor-grabbing",
      )}
    >
      <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60" />
      <span
        className={cn(
          "mt-1 size-1.5 shrink-0 rounded-full",
          priorityMeta.dotClass,
        )}
      />
      <span className="line-clamp-2 min-w-0 flex-1 text-foreground/90">
        {task.title}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnschedule();
        }}
        className="-m-1 rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
        aria-label="Hide from rail"
      >
        <X className="size-3 text-muted-foreground" />
      </button>
    </li>
  );
}
