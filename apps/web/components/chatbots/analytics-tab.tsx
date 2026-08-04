"use client";

import { useEffect, useState } from "react";
import { ChartNoAxesColumn, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatbotAnalytics } from "@/lib/chatbots/analytics";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

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
  const maxVolume = Math.max(1, ...volume.map((v) => v.messages));
  const sentimentTotal = sentiment.positive + sentiment.neutral + sentiment.negative;

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
          <div className="flex h-20 items-end gap-1">
            {volume.map((v) => (
              <div
                key={v.day}
                title={`${v.day}: ${v.messages}`}
                className="flex-1 rounded-t-sm bg-foreground/70"
                style={{ height: `${Math.max(4, (v.messages / maxVolume) * 100)}%` }}
              />
            ))}
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
              className="bg-muted-foreground/40"
              style={{ width: `${(sentiment.neutral / sentimentTotal) * 100}%` }}
            />
            <span
              className="bg-destructive"
              style={{ width: `${(sentiment.negative / sentimentTotal) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {sentiment.positive} positive · {sentiment.neutral} neutral ·{" "}
            {sentiment.negative} negative
          </p>
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
          <ul className="divide-y divide-border">
            {topics.map((t) => {
              const negShare = t.count > 0 ? t.sentiment.negative / t.count : 0;
              return (
                <li key={t.topic} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{t.topic}</span>
                  {negShare >= 0.34 ? (
                    <StatusBadge tone="danger">trending negative</StatusBadge>
                  ) : null}
                  <span
                    className={cn(
                      "w-10 text-right text-sm tabular-nums",
                      "text-muted-foreground",
                    )}
                  >
                    {t.count}
                  </span>
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
