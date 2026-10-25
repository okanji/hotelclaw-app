"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_TICK,
  COLOR,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_CURSOR,
  TOOLTIP_LABEL_STYLE,
} from "@/components/insights/chart-style";
import { formatDay } from "@/lib/cycles/dates";
import type { BurnupPoint } from "@/lib/cycles/burnup";
import { cn } from "@/lib/utils";

/**
 * Linear's cycle burn-up: Scope, Started and Completed over the cycle's
 * days. Days that haven't happened yet are null, so the lines stop at today
 * while the x-axis still spans the whole cycle. Every colour comes off the
 * token layer (chart-style): scope is the neutral ink, started the warning
 * hue, completed the success hue.
 */
export const BURNUP_SERIES = [
  { key: "scope", name: "Scope", color: COLOR.muted, dash: "4 3" },
  { key: "started", name: "Started", color: COLOR.warning, dash: undefined },
  { key: "completed", name: "Completed", color: COLOR.done, dash: undefined },
] as const;

export function BurnupChart({
  points,
  className,
}: {
  points: BurnupPoint[];
  className?: string;
}) {
  const data = points.map((p) => ({ ...p, label: formatDay(p.date) }));
  return (
    <div className={cn("h-40 w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            width={28}
            allowDecimals={false}
          />
          <Tooltip
            cursor={TOOLTIP_CURSOR}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
          />
          {BURNUP_SERIES.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The small legend row under/above a burn-up. */
export function BurnupLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-xs text-faint-foreground", className)}>
      {BURNUP_SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-0.5 w-3 rounded-full"
            style={{ background: s.color }}
          />
          {s.name}
        </span>
      ))}
    </div>
  );
}
