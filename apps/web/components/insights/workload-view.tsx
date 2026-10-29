"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Av } from "@/components/gr8r/home-glyphs";
import { G8Legend, G8Note, G8Rows, G8Stats } from "./g8-insights";
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
  const blockedTotal = rows.reduce((a, r) => a + r.blocked, 0);

  return (
    <div className="flex flex-col gap-5">
        <G8Stats
          items={[
            { k: "People with open work", v: rows.length },
            {
              k: "Blocked anywhere",
              v: blockedTotal,
              flag:
                blockedTotal > 0 ? (
                  <span className="badge amber">Unblock</span>
                ) : undefined,
            },
            {
              k: "Urgent unassigned",
              v: unassignedUrgent,
              flag:
                unassignedUrgent > 0 ? (
                  <span className="badge amber">Assign</span>
                ) : undefined,
            },
          ]}
        />
        {rows.length === 0 ? (
          <G8Note>No assigned open work yet.</G8Note>
        ) : (
          <>
            <G8Legend
              items={[
                { label: "Overdue", color: "var(--g8-red)" },
                { label: "Urgent", color: "var(--g8-amber)" },
                { label: "Other open", color: "var(--g8-text-4)" },
                { label: "Completed/week", color: COLOR.done, line: true },
              ]}
            />
            <G8Rows>
              {rows.map((row) => (
                <PersonRow key={row.userId} row={row} maxOpen={maxOpen} />
              ))}
            </G8Rows>
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
  return (
    <div className="mini" style={{ cursor: "default", padding: "8px 14px" }}>
      <Av
        member={{ id: row.userId, name: row.name, avatarUrl: row.avatarUrl }}
        size="md"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="trunc" style={{ fontWeight: 500 }}>
            {row.name}
          </span>
          <span className="m">
            {row.open} open
            {row.blocked > 0 ? (
              <span style={{ color: "var(--g8-red)" }}> · {row.blocked} blocked</span>
            ) : null}
            {row.overdue > 0 ? (
              <span style={{ color: "var(--g8-red)" }}> · {row.overdue} overdue</span>
            ) : null}
            {row.urgent > 0 ? (
              <span style={{ color: "var(--g8-amber)" }}> · {row.urgent} urgent</span>
            ) : null}
            {row.meetingHours > 0 ? (
              <span> · {row.meetingHours}h meetings</span>
            ) : null}
          </span>
        </div>
        <div
          className="ins-bar"
          style={{ height: 4, gap: 0 }}
          role="img"
          aria-label={`${row.open} open tasks`}
        >
          <div className="flex h-full" style={{ width: `${Math.max(widthPct, 2)}%` }}>
            <i style={{ "--g8-c": "var(--g8-red)", width: `${overduePct}%` } as CSSVars} />
            <i
              style={
                {
                  "--g8-c": "var(--g8-amber)",
                  width: `${Math.max(0, urgentPct - overduePct)}%`,
                } as CSSVars
              }
            />
            <i style={{ "--g8-c": "var(--g8-text-4)", flex: 1 } as CSSVars} />
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
    </div>
  );
}

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;
