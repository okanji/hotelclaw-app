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
import {
  Stats,
  DividerList,
  ROW_CLASS,
  WidgetEmpty,
} from "@/components/home/editorial-section";
import { cn } from "@/lib/utils";
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

const STATUS_META: Record<string, { label: string; dot: string; fill: string }> = {
  todo: {
    label: "To do",
    dot: "bg-(--chart-3)",
    fill: "bg-(--chart-3)",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-(--chart-2)",
    fill: "bg-(--chart-2)",
  },
  blocked: {
    label: "Blocked",
    dot: "bg-rose-500",
    fill: "bg-rose-500",
  },
};

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
          <Stats
            items={[
              { label: "created this week", value: thisWeek?.created ?? 0 },
              { label: "completed this week", value: thisWeek?.done ?? 0 },
              { label: "open", value: metrics.snapshot.openTotal },
              {
                label: "overdue",
                value: metrics.snapshot.overdueTotal,
                tone: "rose",
              },
              ...(metrics.cycleTime.medianDays !== null
                ? [
                    {
                      label: `day median cycle${
                        cycleDelta !== null
                          ? ` (${cycleDelta > 0 ? "+" : ""}${cycleDelta} vs prior)`
                          : ""
                      }`,
                      value: metrics.cycleTime.medianDays,
                    },
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
            <WidgetEmpty>
              No task activity in the last 8 weeks — the flow chart starts
              with the first created or completed task.
            </WidgetEmpty>
          )}
      {hasFlowData ? (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded-full bg-emerald-500" />
            Completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded-full bg-(--chart-3)" />
            Created
          </span>
        </div>
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
    <p className="flex max-w-[72ch] items-start gap-2.5 text-sm leading-relaxed text-pretty text-muted-foreground">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-foreground/50" />
      <span>{summary}</span>
    </p>
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
    return <WidgetEmpty>No open work — everything is done.</WidgetEmpty>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full">
        {byStatus
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.status}
              className={cn("h-full", STATUS_META[s.status]?.fill)}
              style={{ width: `${(s.count / openTotal) * 100}%` }}
              title={`${STATUS_META[s.status]?.label}: ${s.count}`}
            />
          ))}
      </div>
      <ul role="list" className="flex flex-col divide-y divide-border/40">
        {byStatus.map((s) => (
          <li key={s.status}>
            <Link
              href={`/p/${propertyId}/tasks`}
              className="group flex items-baseline gap-2.5 px-1 py-2"
            >
              <span
                className={cn(
                  "size-2 shrink-0 self-center rounded-full",
                  STATUS_META[s.status]?.dot,
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground group-hover:underline">
                {STATUS_META[s.status]?.label ?? s.status}
              </span>
              {s.overdue > 0 ? (
                <span className="shrink-0 text-xs tabular-nums text-rose-500">
                  {s.overdue} overdue
                </span>
              ) : null}
              <span className="shrink-0 text-sm font-semibold tracking-tight tabular-nums text-foreground">
                {s.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
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
      <WidgetEmpty>
        Nothing stuck — no blocked, overdue, or unassigned urgent work.
      </WidgetEmpty>
    );
  return (
    <DividerList>
      {items.slice(0, 12).map((item) => {
        const meta = KIND_META[item.kind];
        const Icon = meta.icon;
        return (
          <li key={`${item.kind}-${item.taskId}`}>
            <Link
              href={`/p/${propertyId}/tasks/${item.taskId}`}
              className={`${ROW_CLASS} group`}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  item.kind === "blocked"
                    ? "text-rose-500"
                    : item.kind === "overdue"
                      ? "text-amber-500"
                      : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground group-hover:underline">
                {item.title}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {meta.label(item)}
              </span>
              {item.assigneeName ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground/80 sm:inline">
                  {item.assigneeName}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </DividerList>
  );
}
