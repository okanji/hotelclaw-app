"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  CircleAlert,
  Hourglass,
  OctagonPause,
  Sparkles,
  UserX,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Legend, G8Note, G8Rows, G8Stats, type G8Stat } from "./g8-insights";
import type { InsightsMetrics, AttentionItem } from "@/lib/insights/metrics";
import { insightsBriefQueryOptions } from "@/lib/query/insights-queries";
import { PROPERTY_SCOPE, type InsightScope } from "@/lib/insights/scope";
import {
  AXIS_TICK,
  COLOR,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_CURSOR,
  TOOLTIP_LABEL_STYLE,
} from "./chart-style";

/** Open-work categories in gr8r's status ink (`--st-*`, red for blocked). */
const STATUS_META: Record<string, { label: string; color: string }> = {
  todo: { label: "To do", color: "var(--g8-st-todo)" },
  in_progress: { label: "In progress", color: "var(--g8-st-progress)" },
  blocked: { label: "Blocked", color: "var(--g8-red)" },
};

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

/**
 * Flow — the heartbeat hero for owners/managers: the AI's plain-language
 * read of the numbers, the stat strip, and the created-vs-completed chart
 * (8 weeks). Section content only — the sortable section shell lives in the
 * insights registry grid.
 */
export function FlowBody({
  propertyId,
  metrics,
  scope = PROPERTY_SCOPE,
}: {
  propertyId: string;
  metrics: InsightsMetrics;
  scope?: InsightScope;
}) {
  const thisWeek = metrics.flow[metrics.flow.length - 1];
  const hasFlowData = metrics.flow.some((w) => w.created > 0 || w.done > 0);
  const cycleDelta =
    metrics.cycleTime.medianDays !== null &&
    metrics.cycleTime.prevMedianDays !== null
      ? Math.round(
          (metrics.cycleTime.medianDays - metrics.cycleTime.prevMedianDays) * 10,
        ) / 10
      : null;

  return (
    <div className="flex flex-col gap-5">
      <MetricsExplainer propertyId={propertyId} scope={scope} />
          <G8Stats
            items={[
              { k: "Created this week", v: thisWeek?.created ?? 0 },
              { k: "Completed this week", v: thisWeek?.done ?? 0 },
              { k: "Open", v: metrics.snapshot.openTotal },
              {
                k: "Overdue",
                v: metrics.snapshot.overdueTotal,
                flag:
                  metrics.snapshot.overdueTotal > 0 ? (
                    <span className="badge amber">Review</span>
                  ) : undefined,
              },
              ...(metrics.cycleTime.medianDays !== null
                ? [
                    {
                      k: "Median cycle time",
                      v: `${metrics.cycleTime.medianDays}d`,
                      d:
                        cycleDelta !== null
                          ? `${cycleDelta > 0 ? "+" : ""}${cycleDelta}d vs prior week`
                          : undefined,
                      tone:
                        cycleDelta !== null && cycleDelta > 0
                          ? ("bad" as const)
                          : cycleDelta !== null && cycleDelta < 0
                            ? ("up" as const)
                            : undefined,
                    } satisfies G8Stat,
                  ]
                : []),
            ]}
          />
          {hasFlowData ? (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={metrics.flow}
                  margin={{ top: 6, right: 2, bottom: 0, left: 2 }}
                >
                  <defs>
                    <linearGradient id="flow-done" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLOR.done} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={COLOR.done} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={AXIS_TICK}
                    interval="preserveStartEnd"
                  />
                  <Tooltip
                    cursor={TOOLTIP_CURSOR}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                  />
                  <Area
                    type="monotone"
                    dataKey="done"
                    name="Completed"
                    stroke={COLOR.done}
                    strokeWidth={2}
                    fill="url(#flow-done)"
                  />
                  <Line
                    type="monotone"
                    dataKey="created"
                    name="Created"
                    stroke={COLOR.series3}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <G8Note>
              No task activity in the last 8 weeks — the flow chart starts
              with the first created or completed task.
            </G8Note>
          )}
      {hasFlowData ? (
        <G8Legend
          items={[
            { label: "Completed", color: COLOR.done, line: true },
            { label: "Created", color: COLOR.series3, line: true },
          ]}
        />
      ) : null}
    </div>
  );
}

/** Open-work distribution, fed from the already-loaded metrics. Section
 *  content only. */
export function OpenWorkBody({
  propertyId,
  metrics,
}: {
  propertyId: string;
  metrics: InsightsMetrics;
}) {
  return (
    <OpenWorkDistribution
      propertyId={propertyId}
      byStatus={metrics.snapshot.byStatus}
      openTotal={metrics.snapshot.openTotal}
    />
  );
}

/** The AI's plain-language read of the charts below — written in the same
 *  generation as the intelligence brief (one model call, one cache row), so
 *  it shares the brief's fingerprint freshness and realtime swap-in. Renders
 *  nothing until the brief lands; the charts stand on their own meanwhile. */
function MetricsExplainer({
  propertyId,
  scope,
}: {
  propertyId: string;
  scope: InsightScope;
}) {
  const { data } = useQuery(insightsBriefQueryOptions(propertyId, scope));
  const summary = data?.brief?.summary;
  if (!summary) return null;
  return (
    <div className="alert info" style={{ maxWidth: "72ch" }}>
      <Gi icon={Sparkles} size={14} />
      <span>{summary}</span>
    </div>
  );
}

/** Three numbers don't need a chart: one segmented bar, then a legend list
 *  with counts and overdue callouts, each row linking into the task board. */
function OpenWorkDistribution({
  propertyId,
  byStatus,
  openTotal,
}: {
  propertyId: string;
  byStatus: InsightsMetrics["snapshot"]["byStatus"];
  openTotal: number;
}) {
  if (openTotal === 0)
    return <G8Note>No open work — everything is done.</G8Note>;

  return (
    <div className="flex flex-col gap-4">
      <div className="ins-bar">
        {byStatus
          .filter((s) => s.count > 0)
          .map((s) => (
            <i
              key={s.status}
              style={
                {
                  "--g8-c": STATUS_META[s.status]?.color ?? "var(--g8-gray)",
                  width: `${(s.count / openTotal) * 100}%`,
                } as CSSVars
              }
              title={`${STATUS_META[s.status]?.label}: ${s.count}`}
            />
          ))}
      </div>
      <G8Rows>
        {byStatus.map((s) => (
          <Link key={s.status} href={`/p/${propertyId}/tasks`} className="mini">
            <span
              className="pdot"
              style={{ "--g8-c": STATUS_META[s.status]?.color ?? "var(--g8-gray)" } as CSSVars}
              aria-hidden="true"
            />
            <span className="tt">{STATUS_META[s.status]?.label ?? s.status}</span>
            {s.overdue > 0 ? <span className="m bad">{s.overdue} overdue</span> : null}
            <span className="num" style={{ fontWeight: 600 }}>
              {s.count}
            </span>
          </Link>
        ))}
      </G8Rows>
    </div>
  );
}

const KIND_META: Record<
  AttentionItem["kind"],
  { icon: typeof CircleAlert; label: (i: AttentionItem) => string }
> = {
  blocked: {
    icon: OctagonPause,
    label: (i) => `blocked ${i.ageDays}d`,
  },
  overdue: {
    icon: CircleAlert,
    label: (i) => `overdue ${i.ageDays}d`,
  },
  likely_to_slip: {
    icon: Hourglass,
    label: (i) => `due ${i.ageDays}d · likely to slip`,
  },
  unassigned_urgent: {
    icon: UserX,
    label: (i) => `${i.priority} · unassigned`,
  },
};

export function AttentionList({
  propertyId,
  items,
}: {
  propertyId: string;
  items: AttentionItem[];
}) {
  if (items.length === 0)
    return (
      <G8Note>
        Nothing stuck — no blocked, overdue, or unassigned urgent work.
      </G8Note>
    );
  return (
    <G8Rows>
      {items.slice(0, 12).map((item) => {
        const meta = KIND_META[item.kind];
        return (
          <Link
            key={`${item.kind}-${item.taskId}`}
            href={`/p/${propertyId}/tasks/${item.taskId}`}
            className="mini"
          >
            <span
              style={{
                display: "inline-flex",
                color:
                  item.kind === "blocked"
                    ? "var(--g8-red)"
                    : item.kind === "overdue"
                      ? "var(--g8-amber)"
                      : "var(--g8-text-3)",
              }}
            >
              <Gi icon={meta.icon} size={14} />
            </span>
            <span className="tt">{item.title}</span>
            <span className="m">{meta.label(item)}</span>
            {item.assigneeName ? (
              <span className="m hidden sm:inline">{item.assigneeName}</span>
            ) : null}
          </Link>
        );
      })}
    </G8Rows>
  );
}
