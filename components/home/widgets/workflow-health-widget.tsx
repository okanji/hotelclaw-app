"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { allPropertyRunsQueryOptions } from "@/lib/query/workflow-queries";
import { Stats, WidgetEmpty } from "../editorial-section";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Company-wide automation health: last-7-days run outcomes + success rate. */
export function WorkflowHealthWidget({ propertyId }: { propertyId: string }) {
  const { data: runs = [], isPending } = useQuery(
    allPropertyRunsQueryOptions(propertyId),
  );
  const [nowTs, setNowTs] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNowTs(Date.now()), []);

  const stats = useMemo(() => {
    if (nowTs === null) return null;
    const recent = runs.filter(
      (r) => new Date(r.started_at).getTime() >= nowTs - WEEK_MS,
    );
    let success = 0;
    let failed = 0;
    let active = 0;
    for (const r of recent) {
      if (r.status === "success") success += 1;
      else if (r.status === "failed" || r.status === "error") failed += 1;
      else active += 1;
    }
    const finished = success + failed;
    const rate = finished > 0 ? Math.round((success / finished) * 100) : null;
    return { total: recent.length, success, failed, active, rate };
  }, [runs, nowTs]);

  if (isPending || !stats) return <WidgetEmpty>Loading runs…</WidgetEmpty>;
  if (stats.total === 0)
    return <WidgetEmpty>No workflow runs in the last 7 days.</WidgetEmpty>;

  return (
    <div className="flex flex-col gap-4">
      <Stats
        items={[
          {
            label: "success · 7d",
            value: stats.rate === null ? "—" : `${stats.rate}%`,
          },
          { label: "runs", value: stats.total },
        ]}
      />

      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {stats.success > 0 ? (
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${(stats.success / stats.total) * 100}%` }}
          />
        ) : null}
        {stats.failed > 0 ? (
          <div
            className="h-full bg-rose-500"
            style={{ width: `${(stats.failed / stats.total) * 100}%` }}
          />
        ) : null}
        {stats.active > 0 ? (
          <div
            className="h-full bg-amber-500"
            style={{ width: `${(stats.active / stats.total) * 100}%` }}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Leg label="Succeeded" value={stats.success} dot="bg-emerald-500" />
        <Leg label="Failed" value={stats.failed} dot="bg-rose-500" />
        <Leg label="Running" value={stats.active} dot="bg-amber-500" />
      </div>
    </div>
  );
}

function Leg({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[0.6875rem] tracking-tight text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  );
}
