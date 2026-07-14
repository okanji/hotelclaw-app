"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatCard, StatCardPill } from "@/components/ui/stat-card";
import {
  DividerList,
  WidgetEmpty,
} from "@/components/home/editorial-section";
import type { InsightsMetrics, WorkloadRow } from "@/lib/insights/metrics";
import { COLOR } from "./chart-style";

/**
 * Workload — per-person load for owners/managers. Each row: a proportional
 * stacked load bar (open in gray, overdue rose, urgent amber on top), the
 * counts, and a 4-week throughput sparkline. Staff sessions never reach this
 * view — the metrics route doesn't return workload for them. Section content
 * only — the sortable section shell lives in the insights registry grid.
 */
export function WorkloadBody({ metrics }: { metrics: InsightsMetrics }) {
  const rows = metrics.workload;
  const maxOpen = Math.max(1, ...rows.map((r) => r.open));
  const unassignedUrgent = metrics.attention.filter(
    (a) => a.kind === "unassigned_urgent",
  ).length;

  return (
    <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="People with open work" value={rows.length} />
          <StatCard
            label="Blocked anywhere"
            value={rows.reduce((a, r) => a + r.blocked, 0)}
            pill={
              rows.reduce((a, r) => a + r.blocked, 0) > 0 ? (
                <StatCardPill tone="warning">Unblock</StatCardPill>
              ) : undefined
            }
          />
          <StatCard
            label="Urgent unassigned"
            value={unassignedUrgent}
            pill={
              unassignedUrgent > 0 ? (
                <StatCardPill tone="warning">Assign</StatCardPill>
              ) : undefined
            }
          />
        </div>
        {rows.length === 0 ? (
          <WidgetEmpty>No assigned open work yet.</WidgetEmpty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-rose-500" />
                Overdue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500" />
                Urgent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-foreground/30" />
                Other open
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[2px] w-4 rounded-full bg-emerald-500" />
                Completed/week
              </span>
            </div>
            <DividerList>
              {rows.map((row) => (
                <PersonRow key={row.userId} row={row} maxOpen={maxOpen} />
              ))}
            </DividerList>
          </>
        )}
    </div>
  );
}

function PersonRow({ row, maxOpen }: { row: WorkloadRow; maxOpen: number }) {
  const widthPct = Math.round((row.open / maxOpen) * 100);
  // Inside the person's bar, overdue + urgent tint the leading segments.
  const overduePct = row.open > 0 ? (row.overdue / row.open) * 100 : 0;
  const urgentPct = row.open > 0 ? (row.urgent / row.open) * 100 : 0;
  const spark = row.doneByWeek.map((done, i) => ({ i, done }));
  const initials = row.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <li className="flex items-center gap-3 px-1 py-3">
      <Avatar className="size-7 shrink-0">
        {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[0.625rem]">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium text-foreground">
            {row.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {row.open} open
            {row.blocked > 0 ? (
              <span className="text-rose-500"> · {row.blocked} blocked</span>
            ) : null}
            {row.overdue > 0 ? (
              <span className="text-rose-500"> · {row.overdue} overdue</span>
            ) : null}
            {row.urgent > 0 ? (
              <span className="text-amber-500"> · {row.urgent} urgent</span>
            ) : null}
            {row.meetingHours > 0 ? (
              <span> · {row.meetingHours}h meetings</span>
            ) : null}
          </span>
        </div>
        <div
          className="h-[3px] overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${row.open} open tasks`}
        >
          <div
            className="flex h-full"
            style={{ width: `${Math.max(widthPct, 2)}%` }}
          >
            <div
              className="h-full bg-rose-500"
              style={{ width: `${overduePct}%` }}
            />
            <div
              className="h-full bg-amber-500"
              style={{ width: `${Math.max(0, urgentPct - overduePct)}%` }}
            />
            <div className="h-full flex-1 bg-foreground/30" />
          </div>
        </div>
      </div>
      <div className="h-8 w-20 shrink-0" title="Completed per week, last 4 weeks">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={spark} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
            <Line
              type="monotone"
              dataKey="done"
              stroke={COLOR.done}
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </li>
  );
}
