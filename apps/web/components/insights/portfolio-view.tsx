"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useOpenProject } from "@/lib/projects/use-open-project";
import {
  DividerList,
  WidgetEmpty,
} from "@/components/home/editorial-section";
import { cn } from "@/lib/utils";
import type { InsightsMetrics, PortfolioRow } from "@/lib/insights/metrics";
import { insightsAnnotationsQueryOptions } from "@/lib/query/insights-queries";

/**
 * Projects portfolio — every active/planned project with its rollup and the
 * deterministic pace flag. At-risk and behind projects sort to the top; the
 * flag's reasons render inline so a manager never has to guess why, and a
 * cached Haiku one-liner adds the "so what" on flagged rows. Section content
 * only — the sortable section shell lives in the insights registry grid.
 */
export function PortfolioBody({
  propertyId,
  metrics,
}: {
  propertyId: string;
  metrics: InsightsMetrics;
}) {
  const hasFlagged = metrics.portfolio.some((p) => p.pace !== "on_pace");
  const { data: annotations = [] } = useQuery({
    ...insightsAnnotationsQueryOptions(propertyId),
    enabled: hasFlagged,
  });
  const noteFor = new Map(annotations.map((a) => [a.projectId, a.note]));

  return metrics.portfolio.length === 0 ? (
    <WidgetEmpty>No active projects yet.</WidgetEmpty>
  ) : (
    <DividerList>
      {metrics.portfolio.map((p) => (
        <ProjectRow
          key={p.projectId}
          propertyId={propertyId}
          row={p}
          aiNote={noteFor.get(p.projectId) ?? null}
        />
      ))}
    </DividerList>
  );
}

function ProjectRow({
  propertyId,
  row,
  aiNote,
}: {
  propertyId: string;
  row: PortfolioRow;
  aiNote: string | null;
}) {
  const openProject = useOpenProject(propertyId);
  return (
    <li>
      <button
        type="button"
        onClick={() => openProject(row.projectId)}
        className="group flex w-full flex-col gap-1.5 px-1 py-3 text-left"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium text-foreground group-hover:underline">
              {row.name}
            </span>
            <PaceBadge pace={row.pace} />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {row.done}/{row.total} done
            {row.blocked > 0 ? (
              <span className="text-rose-500"> · {row.blocked} blocked</span>
            ) : null}
            {row.overdue > 0 ? (
              <span className="text-rose-500"> · {row.overdue} overdue</span>
            ) : null}
            {row.targetDate ? <span> · due {shortDate(row.targetDate)}</span> : null}
          </span>
        </div>
        <div className="h-[3px] overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              row.pace === "on_pace" ? "bg-emerald-500" : "bg-amber-500",
            )}
            style={{ width: `${row.completionPct}%` }}
          />
        </div>
        {row.paceReasons.length > 0 ? (
          <p className="text-xs text-pretty text-amber-600 dark:text-amber-500">
            {row.paceReasons.join(" · ")}
          </p>
        ) : null}
        {aiNote ? (
          <p className="flex items-start gap-1.5 text-xs text-pretty text-muted-foreground">
            <Sparkles className="mt-0.5 size-3 shrink-0" />
            {aiNote}
          </p>
        ) : null}
      </button>
    </li>
  );
}

function PaceBadge({ pace }: { pace: PortfolioRow["pace"] }) {
  if (pace === "on_pace")
    return (
      <span className="shrink-0 text-xs text-muted-foreground">
        on pace
      </span>
    );
  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium",
        pace === "behind" ? "text-amber-500" : "text-rose-500",
      )}
    >
      {pace === "behind" ? "behind" : "at risk"}
    </span>
  );
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
