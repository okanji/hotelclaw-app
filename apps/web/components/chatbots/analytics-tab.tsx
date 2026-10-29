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
import { Gi } from "@/components/gr8r/icon";
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
      <p className="muted py-12 text-center">
        Couldn&apos;t load analytics — try again in a moment.
      </p>
    );
  }
  if (!data) {
    return (
      <div className="row muted justify-center py-12">
        <Gi icon={Loader2} size={16} className="animate-spin" />
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
      <div className="panel">
        <div className="empty-state">
          <div className="glyph">
            <Gi icon={ChartNoAxesColumn} />
          </div>
          <p className="es-h">No conversations yet</p>
          <p>Once guests start chatting, topics, sentiment, and volume show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      {/* gr8r `.stats` strip — six cells, wrapping to 3 / 2 on narrow panes. */}
      <div className="stats grid-cols-2! sm:grid-cols-3! lg:grid-cols-6!">
        <Stat label="Conversations" value={totals.conversations} />
        <Stat label="Messages" value={totals.messages} />
        <Stat label="Orders placed" value={totals.ordersPlaced} />
        <Stat label="Escalated" value={totals.escalated} />
        <Stat label="Thumbs up" value={totals.thumbsUp} />
        <Stat label="Thumbs down" value={totals.thumbsDown} />
      </div>

      {/* 14-day volume */}
      <section className="panel" style={{ padding: 14 }}>
        <p className="label" style={{ marginBottom: 12 }}>Bot replies — last 14 days</p>
        {volume.length === 0 ? (
          <p className="hint">No traffic yet.</p>
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
        <section className="panel" style={{ padding: 14 }}>
          <p className="label" style={{ marginBottom: 12 }}>Guest sentiment</p>
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
            className="muted mt-2 flex flex-wrap gap-x-4 gap-y-1"
            style={{ fontSize: 12 }}
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
      <section className="panel" style={{ padding: 14 }}>
        <p className="label" style={{ marginBottom: 4 }}>What guests ask about</p>
        <p className="hint" style={{ marginBottom: 12 }}>
          Topics are labeled automatically once a conversation settles. A
          topic trending negative is your cue to fix the knowledge base or
          the underlying problem.
        </p>
        {topics.length === 0 ? (
          <p className="hint">
            Nothing labeled yet — check back after a few conversations.
          </p>
        ) : (
          <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {topics.map((t) => {
              const negShare = t.count > 0 ? t.sentiment.negative / t.count : 0;
              return (
                <li key={t.topic} className="py-2" style={{ borderTop: "1px solid var(--g8-divider)" }}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t.topic}
                    </span>
                    {negShare >= 0.34 ? (
                      <span className="badge red">
                        <span className="dot" />
                        trending negative
                      </span>
                    ) : null}
                    <span className="muted num w-10 shrink-0 text-right">
                      {t.count}
                    </span>
                  </div>
                  {/* Count-proportional meter (SummaryStrip pattern) — a
                      VALUE, so warm ink, never `--primary`. */}
                  <div className="meter mt-1.5" style={{ height: 4 }}>
                    <i style={{ width: `${(t.count / maxTopicCount) * 100}%` }} />
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
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}
