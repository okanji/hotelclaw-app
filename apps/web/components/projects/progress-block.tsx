"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Stat, StatGroup } from "@/components/ui/stat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  pct,
  progressByAssignee,
  progressStats,
  type ProgressTask,
} from "@/lib/initiatives/planning";
import { OverviewSection } from "./workspace-shell";
import { COLUMNS } from "@/components/tasks/kanban";
import { StatusIcon } from "@/components/tasks/task-icons";
import type { TaskStatus } from "@/lib/db/types";

/** Status ink for the issue tally (only the statuses that need attention
 *  or mark completion get a hue; to-do stays foreground). */
const STATUS_TALLY: Partial<Record<TaskStatus, string>> = {
  in_progress: "text-warning",
  blocked: "text-destructive",
  done: "text-success",
};

type Person = { id: string; name: string | null; avatarUrl: string | null };

function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Completed (solid) over started (soft) on one track, out of scope. */
function ScopeBar({
  scope,
  started,
  completed,
  className,
}: {
  scope: number;
  started: number;
  completed: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex h-1 overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={`${completed} of ${scope} points completed, ${started} started`}
    >
      {completed > 0 ? (
        <div className="h-full shrink-0 bg-success/90" style={{ width: `${pct(completed, scope)}%` }} />
      ) : null}
      {started > 0 ? (
        <div className="h-full shrink-0 bg-warning/70" style={{ width: `${pct(started, scope)}%` }} />
      ) : null}
    </div>
  );
}

/**
 * Linear's project Progress block: Scope / Started / Completed in estimate
 * points (an unestimated task counts as 1 — `lib/initiatives/planning.ts`),
 * then the same three numbers per assignee.
 */
export function ProjectProgressBlock({
  tasks,
  people,
}: {
  tasks: ProgressTask[];
  people: Person[];
}) {
  const stats = useMemo(() => progressStats(tasks), [tasks]);
  const rows = useMemo(() => progressByAssignee(tasks), [tasks]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  // Issue COUNTS per status (the points above can hide a blocked issue) —
  // folded in from the old "N of M completed" bar so Overview has one
  // progress block.
  const statusCounts = useMemo(() => {
    const c: Record<TaskStatus, number> = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
    for (const t of tasks) c[t.status] += 1;
    return c;
  }, [tasks]);

  if (stats.tasks === 0) {
    return (
      <OverviewSection title="Progress">
        <p className="text-sm text-muted-foreground">
          No issues yet — scope and progress appear as work is added.
        </p>
      </OverviewSection>
    );
  }

  return (
    <OverviewSection
      title="Progress"
      action={
        <span className="text-sm tabular-nums text-muted-foreground">
          {stats.doneTasks}/{stats.tasks} issues
        </span>
      }
    >
      <StatGroup cols={3}>
        <Stat
          label="Scope"
          value={stats.scope}
          delta={`${stats.tasks} ${stats.tasks === 1 ? "issue" : "issues"} · points`}
        />
        <Stat
          label="Started"
          value={stats.started}
          delta={`${pct(stats.started, stats.scope)}%`}
          tone={stats.started > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="Completed"
          value={stats.completed}
          delta={`${pct(stats.completed, stats.scope)}%`}
          tone={stats.completed > 0 ? "success" : "neutral"}
        />
      </StatGroup>
      <ScopeBar scope={stats.scope} started={stats.started} completed={stats.completed} />
      <dl className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {COLUMNS.map((s) =>
          statusCounts[s.id] > 0 ? (
            <div key={s.id} className="flex items-center gap-1">
              <StatusIcon status={s.id} className="size-3 text-muted-foreground" />
              <dt className="sr-only">{s.label}</dt>
              <dd className="text-sm tabular-nums text-muted-foreground">
                <span className={STATUS_TALLY[s.id] ?? "text-foreground"}>
                  {statusCounts[s.id]}
                </span>
                <span className="ml-1">{s.label}</span>
              </dd>
            </div>
          ) : null,
        )}
      </dl>

      <ul role="list" className="mt-2 flex flex-col">
        {rows.map((r) => {
          const p = r.assigneeId ? byId.get(r.assigneeId) : undefined;
          const label = r.assigneeId ? (p?.name ?? "Former member") : "Unassigned";
          return (
            <li
              key={r.assigneeId ?? "none"}
              className="flex min-h-[37px] items-center gap-3 border-t border-border first:border-0"
            >
              <Avatar className="size-5 shrink-0">
                {p?.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                <AvatarFallback className="bg-accent-pressed text-[10px] font-medium text-secondary-ink">
                  {r.assigneeId ? initials(p?.name) : "–"}
                </AvatarFallback>
              </Avatar>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  r.assigneeId ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              <ScopeBar
                scope={r.scope}
                started={r.started}
                completed={r.completed}
                className="w-20 shrink-0 sm:w-28"
              />
              <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {r.completed}/{r.scope}
              </span>
            </li>
          );
        })}
      </ul>
    </OverviewSection>
  );
}
