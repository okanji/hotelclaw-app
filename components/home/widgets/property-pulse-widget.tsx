"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { Stats, WidgetEmpty } from "../editorial-section";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 6;

/** Company-wide momentum: tasks completed this week + a 6-week velocity area
 *  chart. "Now" is captured once in an effect so the week math stays pure. */
export function PropertyPulseWidget({ propertyId }: { propertyId: string }) {
  const { data: tasks = [], isPending } = useQuery(
    tasksQueryOptions(propertyId),
  );
  const [nowTs, setNowTs] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNowTs(Date.now()), []);

  const { series, thisWeek, openTotal } = useMemo(() => {
    if (nowTs === null) return { series: [], thisWeek: 0, openTotal: 0 };
    const done = tasks.filter((t) => t.status === "done");
    const buckets = Array.from({ length: WEEKS }, (_, i) => {
      const end = nowTs - (WEEKS - 1 - i) * 7 * DAY_MS;
      const start = end - 7 * DAY_MS;
      return { start, end, label: weekLabel(end), count: 0 };
    });
    for (const t of done) {
      const ts = new Date(t.updated_at).getTime();
      for (const b of buckets) {
        if (ts > b.start && ts <= b.end) {
          b.count += 1;
          break;
        }
      }
    }
    return {
      series: buckets.map((b) => ({ label: b.label, done: b.count })),
      thisWeek: buckets[buckets.length - 1]?.count ?? 0,
      openTotal: tasks.filter((t) => t.status !== "done").length,
    };
  }, [tasks, nowTs]);

  if (isPending || nowTs === null)
    return <WidgetEmpty>Loading momentum…</WidgetEmpty>;
  if (tasks.length === 0)
    return <WidgetEmpty>No tasks yet — the pulse starts here.</WidgetEmpty>;

  return (
    <div className="flex flex-col gap-4">
      <Stats
        items={[
          { label: "completed this week", value: thisWeek },
          { label: "still open", value: openTotal },
        ]}
      />
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={series}
            margin={{ top: 6, right: 2, bottom: 0, left: 2 }}
          >
            <defs>
              <linearGradient id="pulse-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-emerald-500)"
                  stopOpacity={0.25}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-emerald-500)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
              interval="preserveStartEnd"
            />
            <Tooltip
              cursor={{ stroke: "var(--color-border)" }}
              contentStyle={{
                borderRadius: "0.5rem",
                border: "1px solid var(--color-border)",
                background: "var(--color-popover)",
                fontSize: "0.75rem",
              }}
              labelStyle={{ color: "var(--color-muted-foreground)" }}
            />
            <Area
              type="monotone"
              dataKey="done"
              name="Completed"
              stroke="var(--color-emerald-500)"
              strokeWidth={2}
              fill="url(#pulse-fill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function weekLabel(endTs: number): string {
  return new Date(endTs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
