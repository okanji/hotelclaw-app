"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { StatusIcon } from "@/components/tasks/task-icons";
import type { TaskStatus } from "@/lib/db/types";
import type { Task } from "@/components/tasks/kanban";
import {
  DividerList,
  ROW_CLASS,
  Stats,
  WidgetEmpty,
} from "../editorial-section";
import { applyTaskFilter, useDashboardFilter } from "../dashboard-filter";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const STATUS_BAR: { id: TaskStatus; label: string; className: string }[] = [
  { id: "todo", label: "To do", className: "bg-muted-foreground/40" },
  { id: "in_progress", label: "In progress", className: "bg-blue-500" },
  { id: "blocked", label: "Blocked", className: "bg-rose-500" },
  { id: "done", label: "Done", className: "bg-emerald-500" },
];

/** Personal task summary in editorial style: an inline stat row, a slim status
 *  bar over the current user's tasks, and a hairline list of what's next. */
export function YourTasksWidget({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const { data: allTasks = [], isPending } = useQuery(
    tasksQueryOptions(propertyId),
  );
  const filter = useDashboardFilter();
  const tasks = useMemo(
    () => applyTaskFilter(allTasks, filter),
    [allTasks, filter],
  );

  const mine = useMemo(
    () => tasks.filter((t) => t.assignee_id === userId),
    [tasks, userId],
  );
  const open = useMemo(() => mine.filter((t) => t.status !== "done"), [mine]);
  const dueSoon = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const cutoff = Date.now() + WEEK_MS;
    return open.filter(
      (t) => t.due_at && new Date(t.due_at).getTime() <= cutoff,
    ).length;
  }, [open]);
  const blocked = useMemo(
    () => open.filter((t) => t.status === "blocked").length,
    [open],
  );
  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
    };
    for (const t of mine) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [mine]);
  const next = useMemo(() => sortByDue(open).slice(0, 5), [open]);

  if (isPending) return <WidgetEmpty>Loading your tasks…</WidgetEmpty>;
  if (mine.length === 0)
    return <WidgetEmpty>No tasks assigned to you. Enjoy the calm.</WidgetEmpty>;

  return (
    <div className="flex flex-col gap-5">
      <Stats
        items={[
          { label: "open", value: open.length },
          { label: "due ≤ 7d", value: dueSoon },
          { label: "blocked", value: blocked, tone: "rose" },
        ]}
      />

      <StatusBar counts={counts} total={mine.length} />

      {next.length > 0 ? (
        <DividerList>
          {next.map((t) => (
            <li key={t.id}>
              <Link
                href={`/p/${propertyId}/tasks/${t.id}`}
                className={cn(ROW_CLASS, "rounded-md transition-colors hover:bg-muted")}
              >
                <StatusIcon status={t.status} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm tracking-tight text-foreground">
                  {t.title || "Untitled task"}
                </span>
                {t.due_at ? (
                  <span
                    className={cn(
                      "shrink-0 text-xs tracking-tight tabular-nums",
                      isOverdue(t.due_at)
                        ? "text-rose-500"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatDue(t.due_at)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </DividerList>
      ) : null}
    </div>
  );
}

function StatusBar({
  counts,
  total,
}: {
  counts: Record<TaskStatus, number>;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {STATUS_BAR.map((s) =>
          counts[s.id] > 0 ? (
            <div
              key={s.id}
              className={cn("h-full", s.className)}
              style={{ width: `${(counts[s.id] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {STATUS_BAR.map((s) =>
          counts[s.id] > 0 ? (
            <span
              key={s.id}
              className="flex items-center gap-1.5 text-xs tracking-tight text-muted-foreground"
            >
              <span className={cn("size-1.5 rounded-full", s.className)} />
              {s.label}
              <span className="tabular-nums text-foreground">
                {counts[s.id]}
              </span>
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function sortByDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.due_at && !b.due_at) return 0;
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  });
}

function isOverdue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.round(
    (d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
