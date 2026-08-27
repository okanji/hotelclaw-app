"use client";

import { useEffect, useState } from "react";
import { ChartNoAxesColumn, Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import type { ChatbotAnalytics } from "@/lib/chatbots/analytics";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { ChartTooltipContent } from "./chart-tooltip";

/** `YYYY-MM-DD` → "Aug 12" without a timezone shift. */
function formatDay(day: string) {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Analytics tab — deterministic counts with Haiku-labeled topics/sentiment
 * (classified lazily by the GET route, cached on conversation rows).
 * Fetched on mount so the first load can pay the classification pass with
 * a spinner instead of blocking the page.
 */
export function AnalyticsTab({
  propertyId,
  chatbotId,
}: {
  propertyId: string;
  chatbotId: string;
}) {
  const [data, setData] = useState<ChatbotAnalytics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/properties/${propertyId}/chatbots/${chatbotId}/analytics`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, chatbotId]);

  if (error) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Couldn&apos;t load analytics — try again in a moment.
      </p>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Crunching conversations…
      </div>
    );
  }

  const { totals, topics, sentiment, volume } = data;
  const sentimentTotal = sentiment.positive + sentiment.neutral + sentiment.negative;
  const maxTopicCount = Math.max(1, ...topics.map((t) => t.count));
  // Faint date labels at first / midpoint / last — enough to anchor the axis
  // without turning a sparkline-sized chart into a labeled grid.
  const axisTicks =
    volume.length > 0
      ? [
          ...new Set([
            volume[0].day,
            volume[Math.floor(volume.length / 2)].day,
            volume[volume.length - 1].day,
          ]),
        ]
      : [];

  if (totals.conversations === 0) {
    return (
      <EmptyState icon={ChartNoAxesColumn} title="No conversations yet">
        Once guests start chatting, topics, sentiment, and volume show up
        here.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Conversations" value={totals.conversations} />
        <Stat label="Messages" value={totals.messages} />
        <Stat label="Orders placed" value={totals.ordersPlaced} />
        <Stat label="Escalated" value={totals.escalated} />
        <Stat label="Thumbs up" value={totals.thumbsUp} />
        <Stat label="Thumbs down" value={totals.thumbsDown} />
      </div>

      {/* 14-day volume */}
      <section className="rounded-lg p-4 shadow-ring">
        <p className="mb-3 text-sm font-medium">Bot replies — last 14 days</p>
        {volume.length === 0 ? (
          <p className="text-xs text-muted-foreground">No traffic yet.</p>
        ) : (
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={volume}
                margin={{ top: 4, right: 2, bottom: 0, left: 2 }}
                barCategoryGap="25%"
              >
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  ticks={axisTicks}
                  tickFormatter={formatDay}
                  tick={{ fontSize: 12, fill: "var(--color-faint-foreground)" }}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  content={<ChartTooltipContent formatLabel={formatDay} />}
                  wrapperStyle={{ outline: "none" }}
                />
                {/* Bars mean more/less, so the monochrome value ramp. */}
                <Bar
                  dataKey="messages"
                  name="replies"
                  fill="var(--chart-4)"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Sentiment */}
      {sentimentTotal > 0 ? (
        <section className="rounded-lg p-4 shadow-ring">
          <p className="mb-3 text-sm font-medium">Guest sentiment</p>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            <span
              className="bg-success"
              style={{ width: `${(sentiment.positive / sentimentTotal) * 100}%` }}
            />
            <span
              className="bg-chart-1"
              style={{ width: `${(sentiment.neutral / sentimentTotal) * 100}%` }}
            />
            <span
              className="bg-destructive"
              style={{ width: `${(sentiment.negative / sentimentTotal) * 100}%` }}
            />
          </div>
          <ul
            role="list"
            className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
          >
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
              <span className="tabular-nums">{sentiment.positive}</span> positive
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-chart-1" />
              <span className="tabular-nums">{sentiment.neutral}</span> neutral
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
              <span className="tabular-nums">{sentiment.negative}</span> negative
            </li>
          </ul>
        </section>
      ) : null}

      {/* Topics */}
      <section className="rounded-lg p-4 shadow-ring">
        <p className="mb-1 text-sm font-medium">What guests ask about</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Topics are labeled automatically once a conversation settles. A
          topic trending negative is your cue to fix the knowledge base or
          the underlying problem.
        </p>
        {topics.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing labeled yet — check back after a few conversations.
          </p>
        ) : (
          <ul role="list" className="divide-y divide-border">
            {topics.map((t) => {
              const negShare = t.count > 0 ? t.sentiment.negative / t.count : 0;
              return (
                <li key={t.topic} className="py-2">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t.topic}
                    </span>
                    {negShare >= 0.34 ? (
                      <StatusBadge tone="danger">trending negative</StatusBadge>
                    ) : null}
                    <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {t.count}
                    </span>
                  </div>
                  {/* Count-proportional meter (SummaryStrip pattern) — a
                      VALUE, so warm ink, never `--primary`. */}
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-secondary-ink"
                      style={{ width: `${(t.count / maxTopicCount) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-3 shadow-ring">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
