"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { MoveDown, MoveUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { spacesQueryOptions } from "@/lib/query/project-queries";

/**
 * Teams pulse (D2 leaderboard, management-only via the Insights surface) —
 * a cross-team table framed around IMPROVEMENT, not absolute ranking:
 * different managers rate differently, so the headline is each team's
 * day-rating delta vs its own previous 14 days. Completion rate and
 * sign-off consistency are self-comparable, so those sort the table.
 * All numbers are deterministic (routine_runs + tasks); no model anywhere.
 */

type TeamPulseRow = {
  spaceId: string;
  name: string;
  icon: string | null;
  rating: number | null;
  ratingDelta: number | null;
  signedOffDays: number;
  completedRuns: number;
  totalRuns: number;
  tasksDone: number;
};

function teamsPulseQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["teams-pulse", propertyId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const now = Date.now();
      const since14 = new Date(now - 14 * 86_400_000).toISOString().slice(0, 10);
      const since28 = new Date(now - 28 * 86_400_000).toISOString().slice(0, 10);
      const [runsRes, tasksRes] = await Promise.all([
        supabase
          .from("routine_runs")
          .select(
            "run_date, completed_at, signed_off_at, rating, routines!inner(space_id)",
          )
          .eq("property_id", propertyId)
          .gte("run_date", since28),
        supabase
          .from("tasks")
          .select("space_id, updated_at")
          .eq("property_id", propertyId)
          .eq("status", "done")
          .gte("updated_at", new Date(now - 14 * 86_400_000).toISOString()),
      ]);
      return {
        runs: (runsRes.data ?? []) as unknown as {
          run_date: string;
          completed_at: string | null;
          signed_off_at: string | null;
          rating: number | null;
          routines: { space_id: string };
        }[],
        doneTasks: (tasksRes.data ?? []) as { space_id: string | null }[],
        since14,
      };
    },
    staleTime: 5 * 60_000,
  });
}

export function TeamsPulseBody({ propertyId }: { propertyId: string }) {
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data } = useQuery(teamsPulseQueryOptions(propertyId));

  const rows = useMemo<TeamPulseRow[]>(() => {
    if (!data) return [];
    const bySpace = new Map<
      string,
      {
        currentRatings: Map<string, number>;
        priorRatings: Map<string, number>;
        signedDays: Set<string>;
        completed: number;
        total: number;
      }
    >();
    const bucket = (spaceId: string) => {
      let b = bySpace.get(spaceId);
      if (!b) {
        b = {
          currentRatings: new Map(),
          priorRatings: new Map(),
          signedDays: new Set(),
          completed: 0,
          total: 0,
        };
        bySpace.set(spaceId, b);
      }
      return b;
    };
    for (const run of data.runs) {
      const b = bucket(run.routines.space_id);
      const inCurrent = run.run_date >= data.since14;
      if (run.rating != null) {
        (inCurrent ? b.currentRatings : b.priorRatings).set(
          run.run_date,
          run.rating,
        );
      }
      if (!inCurrent) continue;
      b.total++;
      if (run.completed_at) b.completed++;
      if (run.signed_off_at) b.signedDays.add(run.run_date);
    }
    const doneBySpace = new Map<string, number>();
    for (const t of data.doneTasks) {
      if (!t.space_id) continue;
      doneBySpace.set(t.space_id, (doneBySpace.get(t.space_id) ?? 0) + 1);
    }

    const avg = (m: Map<string, number>): number | null => {
      if (m.size === 0) return null;
      const values = [...m.values()];
      return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    };

    return spaces
      .map((s) => {
        const b = bySpace.get(s.id);
        const rating = b ? avg(b.currentRatings) : null;
        const prior = b ? avg(b.priorRatings) : null;
        return {
          spaceId: s.id,
          name: s.name,
          icon: s.icon,
          rating,
          ratingDelta:
            rating != null && prior != null
              ? Math.round((rating - prior) * 10) / 10
              : null,
          signedOffDays: b?.signedDays.size ?? 0,
          completedRuns: b?.completed ?? 0,
          totalRuns: b?.total ?? 0,
          tasksDone: doneBySpace.get(s.id) ?? 0,
        };
      })
      .filter((r) => r.totalRuns > 0 || r.tasksDone > 0)
      .sort((a, b) => {
        const ar = a.totalRuns > 0 ? a.completedRuns / a.totalRuns : 0;
        const br = b.totalRuns > 0 ? b.completedRuns / b.totalRuns : 0;
        return br - ar;
      });
  }, [data, spaces]);

  if (rows.length === 0) {
    return (
      <p className="rounded-md bg-muted px-6 py-8 text-center text-sm text-muted-foreground">
        Nothing to compare yet — team pulse fills in once teams run daily ops.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="h-8 border-b border-border text-left text-xs leading-3 font-medium text-faint-foreground">
            <th className="pr-3 font-medium">Team</th>
            <th className="pr-3 font-medium">Day rating (14d)</th>
            <th className="pr-3 font-medium">Routines done</th>
            <th className="pr-3 font-medium">Days signed off</th>
            <th className="font-medium">Tasks done</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const completion =
              row.totalRuns > 0
                ? Math.round((row.completedRuns / row.totalRuns) * 100)
                : null;
            return (
              <tr key={row.spaceId} className="group h-[37px] transition-colors hover:bg-accent">
                <td className="pr-3">
                  <Link
                    href={`/p/${propertyId}/spaces/${row.spaceId}`}
                    className="flex min-w-0 items-center gap-1.5 font-medium text-foreground hover:underline"
                  >
                    {row.icon ? (
                      <span className="shrink-0">{row.icon}</span>
                    ) : null}
                    <span className="truncate">{row.name}</span>
                  </Link>
                </td>
                <td className="pr-3 tabular-nums">
                  {row.rating != null ? (
                    <span className="inline-flex items-center gap-1.5">
                      {row.rating}/10
                      {row.ratingDelta != null && row.ratingDelta !== 0 ? (
                        <span
                          className={cn(
                            "inline-flex items-center text-xs font-medium",
                            row.ratingDelta > 0
                              ? "text-success"
                              : "text-destructive",
                          )}
                          title="vs the previous 14 days"
                        >
                          {row.ratingDelta > 0 ? (
                            <MoveUp className="size-3" />
                          ) : (
                            <MoveDown className="size-3" />
                          )}
                          {Math.abs(row.ratingDelta)}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-faint-foreground">—</span>
                  )}
                </td>
                <td className="pr-3 tabular-nums text-muted-foreground">
                  {completion != null
                    ? `${row.completedRuns}/${row.totalRuns} · ${completion}%`
                    : "—"}
                </td>
                <td className="pr-3 tabular-nums text-muted-foreground">
                  {row.signedOffDays}
                </td>
                <td className="tabular-nums text-muted-foreground">
                  {row.tasksDone}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Ratings compare each team to its own previous 14 days — managers rate
        differently, so deltas are the fair signal.
      </p>
    </div>
  );
}
