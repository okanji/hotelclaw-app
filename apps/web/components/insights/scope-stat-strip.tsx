"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { insightsStripQueryOptions } from "@/lib/query/insights-queries";

/**
 * Ambient header stat strip for project/space detail pages — the Insights
 * rollup where people already work: completion · open · blocked · overdue ·
 * pace (projects) or stale-SOP count (spaces), over a 2px progress bar.
 * Renders nothing until data arrives and nothing when the scope has no
 * tasks, so empty scopes stay clean.
 */
export function ScopeStatStrip({
  propertyId,
  scope,
  className,
}: {
  propertyId: string;
  scope: { kind: "project" | "space"; id: string };
  className?: string;
}) {
  const { data } = useQuery(insightsStripQueryOptions(propertyId, scope));
  if (!data || data.total === 0) return null;

  const parts: { text: string; tone?: "rose" | "amber" }[] = [
    { text: `${data.completionPct}% complete` },
    { text: `${data.open} open` },
  ];
  if (data.blocked > 0) parts.push({ text: `${data.blocked} blocked`, tone: "rose" });
  if (data.overdue > 0) parts.push({ text: `${data.overdue} overdue`, tone: "rose" });
  if (data.pace && data.pace !== "on_pace")
    parts.push({
      text: data.pace === "behind" ? "behind pace" : "at risk",
      tone: "amber",
    });
  else if (data.pace === "on_pace" && data.targetDate)
    parts.push({ text: "on pace" });
  if (data.staleSops !== null && data.staleSops > 0)
    parts.push({ text: `${data.staleSops} stale pinned doc${data.staleSops === 1 ? "" : "s"}`, tone: "amber" });
  if (data.targetDate)
    parts.push({
      text: `due ${new Date(data.targetDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`,
    });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p
        className="text-xs text-muted-foreground"
        title={data.paceReasons.join(" · ") || undefined}
      >
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 ? <span className="text-faint-foreground"> · </span> : null}
            <span
              className={cn(
                p.tone === "rose" && "text-destructive",
                p.tone === "amber" && "text-warning",
              )}
            >
              {p.text}
            </span>
          </span>
        ))}
      </p>
      <div className="h-[2px] w-full max-w-64 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            data.pace && data.pace !== "on_pace"
              ? "bg-warning"
              : "bg-success",
          )}
          style={{ width: `${data.completionPct}%` }}
        />
      </div>
    </div>
  );
}
