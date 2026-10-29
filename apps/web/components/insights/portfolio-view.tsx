"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { Gi } from "@/components/gr8r/icon";
import { ProgBar } from "@/components/gr8r/home-glyphs";
import { G8Note, G8Rows } from "./g8-insights";
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
    <G8Note>No active projects yet.</G8Note>
  ) : (
    <G8Rows>
      {metrics.portfolio.map((p) => (
        <ProjectRow
          key={p.projectId}
          propertyId={propertyId}
          row={p}
          aiNote={noteFor.get(p.projectId) ?? null}
        />
      ))}
    </G8Rows>
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
    <button
      type="button"
      onClick={() => openProject(row.projectId)}
      className="mini tall"
    >
      <span className="row" style={{ gap: 10, alignItems: "baseline" }}>
        <span className="row" style={{ gap: 8, minWidth: 0, flex: 1, alignItems: "baseline" }}>
          <span className="trunc" style={{ fontWeight: 500 }}>
            {row.name}
          </span>
          <PaceBadge pace={row.pace} />
        </span>
        <span className="m">
          {row.done}/{row.total} done
          {row.blocked > 0 ? <span style={{ color: "var(--g8-red)" }}> · {row.blocked} blocked</span> : null}
          {row.overdue > 0 ? <span style={{ color: "var(--g8-red)" }}> · {row.overdue} overdue</span> : null}
          {row.targetDate ? <span> · due {shortDate(row.targetDate)}</span> : null}
        </span>
      </span>
      <span className="row">
        <ProgBar
          value={row.completionPct}
          tone={row.pace === "on_pace" ? "green" : "amber"}
        />
      </span>
      {row.paceReasons.length > 0 ? (
        <span style={{ fontSize: "var(--g8-fs-xs)", color: "var(--g8-amber)" }}>
          {row.paceReasons.join(" · ")}
        </span>
      ) : null}
      {aiNote ? (
        <span className="row muted" style={{ gap: 6, alignItems: "flex-start", fontSize: "var(--g8-fs-xs)" }}>
          <Gi icon={Sparkles} size={12} />
          {aiNote}
        </span>
      ) : null}
    </button>
  );
}

function PaceBadge({ pace }: { pace: PortfolioRow["pace"] }) {
  if (pace === "on_pace") return <span className="badge green">On pace</span>;
  return (
    <span className={pace === "behind" ? "badge amber" : "badge red"}>
      <span className="dot" />
      {pace === "behind" ? "Behind" : "At risk"}
    </span>
  );
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
