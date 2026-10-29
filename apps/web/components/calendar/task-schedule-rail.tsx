"use client";

import { isDone } from "@/lib/tasks/statuses";
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDraggable } from "@dnd-kit/core";
import { CircleDashed, X } from "lucide-react";
import { toast } from "sonner";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { unscheduleTask } from "@/lib/calendar/actions";
import { Gi } from "@/components/gr8r/icon";
import { PrIcon } from "@/components/gr8r/home-glyphs";
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
  /** "task" = unscheduled rail chip; "task-due" = a deadline chip on the grid. */
  kind: "task" | "task-due";
  taskId: string;
  title: string;
  priority: keyof typeof PRIORITY_META;
  /** The deadline chip's current due date (ISO), so a day-drop keeps its time. */
  dueAt?: string;
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
    // A drag ghost genuinely floats, so it takes the ONE elevation recipe.
    // The room wraps this in a `.g8 .cal-ghost` (it portals out of the shell).
    <div className="cal-ghost-chip">
      <PrIcon priority={priority} size={13} />
      <span className="line-clamp-2 min-w-0 flex-1">{title}</span>
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
      (t) => !t.scheduled_start && !isDone(t),
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

  // gr8r-styled rail section (`.cal-rail-*`, gr8r-ext.css): header with a
  // count, priority groups, draggable rows with the gr8r priority glyph.
  return (
    <section className="cal-rail-sec grow" aria-label="Unscheduled tasks">
      <div className="cal-rail-h">
        <Gi icon={CircleDashed} size={14} />
        Unscheduled
        <span className="cnt">{total}</span>
      </div>
      <div className="cal-rail-b">
        {groups.map(({ key, meta, tasks }) => (
          <div key={key}>
            <div
              className="cal-rail-grp"
              style={key === "urgent" ? { color: "var(--g8-red)" } : undefined}
            >
              <span>{meta.label}</span>
              <span className="num">{tasks.length}</span>
            </div>
            <ul role="list">
              {tasks.map((task) => (
                <TaskChip
                  key={task.id}
                  task={task}
                  onUnschedule={() => handleUnschedule(task.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="cal-rail-f">Drag a task onto the grid to schedule it</div>
    </section>
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
  return (
    <li
      ref={setNodeRef}
      // The ghost lives in the room's DragOverlay; the source chip just
      // dims in place so the list doesn't reflow mid-drag.
      style={{ opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className="cal-rail-item"
    >
      <PrIcon priority={task.priority} size={13} />
      <span className="line-clamp-2 min-w-0 flex-1">{task.title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnschedule();
        }}
        className="ibtn ibtn-xs"
        aria-label="Hide from rail"
      >
        <Gi icon={X} size={12} />
      </button>
    </li>
  );
}
