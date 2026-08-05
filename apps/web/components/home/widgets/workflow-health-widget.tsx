"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { allPropertyRunsQueryOptions } from "@/lib/query/workflow-queries";
import { WidgetEmpty } from "../editorial-section";
import { Stat, StatGroup } from "@/components/ui/stat";

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
    // Dry runs (test executions) don't count toward automation health.
    const recent = runs.filter(
      (r) => !r.is_dry_run && new Date(r.started_at).getTime() >= nowTs - WEEK_MS,
    );
    let success = 0;
    let failed = 0;
    let active = 0;
    // Which workflows are failing, by name — "90% success" alone doesn't tell
    // the user WHAT to fix. Keyed by workflow so repeat failures count once
    // per workflow with a tally.
    const failing = new Map<string, { name: string; count: number }>();
    for (const r of recent) {
      if (r.status === "success") success += 1;
      else if (r.status === "failed" || r.status === "error") {
        failed += 1;
        const entry = failing.get(r.workflow_id);
        if (entry) entry.count += 1;
        else failing.set(r.workflow_id, { name: r.workflow_name, count: 1 });
      } else active += 1;
    }
    const finished = success + failed;
    const rate = finished > 0 ? Math.round((success / finished) * 100) : null;
    const failingTop = [...failing.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { total: recent.length, success, failed, active, rate, failingTop };
  }, [runs, nowTs]);

  if (isPending || !stats) return <WidgetEmpty>Loading runs…</WidgetEmpty>;
  if (stats.total === 0)
    return <WidgetEmpty>No workflow runs in the last 7 days.</WidgetEmpty>;

  return (
    <div className="flex flex-col gap-4">
      <StatGroup cols={2}>
        <Stat
          label="success · 7d"
          value={stats.rate === null ? "—" : `${stats.rate}%`}
        />
        <Stat label="runs" value={stats.total} />
      </StatGroup>

      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {stats.success > 0 ? (
          <div
            className="h-full bg-success"
            style={{ width: `${(stats.success / stats.total) * 100}%` }}
          />
        ) : null}
        {stats.failed > 0 ? (
          <div
            className="h-full bg-destructive"
            style={{ width: `${(stats.failed / stats.total) * 100}%` }}
          />
        ) : null}
        {stats.active > 0 ? (
          <div
            className="h-full bg-warning"
            style={{ width: `${(stats.active / stats.total) * 100}%` }}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Leg label="Succeeded" value={stats.success} dot="bg-success" />
        <Leg label="Failed" value={stats.failed} dot="bg-destructive" />
        <Leg label="Running" value={stats.active} dot="bg-warning" />
      </div>

      {stats.failingTop.length > 0 ? (
        <ul role="list" className="-mx-2 flex flex-col border-t border-border pt-2">
          {stats.failingTop.map((w) => (
            <li key={w.id}>
              <Link
                href={`/p/${propertyId}/workflows/${w.id}/runs`}
                className="group flex min-h-[37px] items-center gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-hidden />
                <span className="min-w-0 truncate group-hover:underline">{w.name}</span>
                <span className="ml-auto tabular-nums">
                  {w.count} {w.count === 1 ? "failure" : "failures"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
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
    <span className="flex items-center gap-1.5 text-xs text-faint-foreground">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  );
}
