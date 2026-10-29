"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Gi } from "@/components/gr8r/icon";
import { insightReportsQueryOptions } from "@/lib/query/insights-queries";
import type { InsightReportRow } from "@/lib/ai/bots/insights-bot";
import { InsightSection } from "./insights-view";
import { ReportMarkdown } from "./report-markdown";
import { G8Note, G8Rows } from "./g8-insights";

/**
 * Reports — the AI weekly report archive. "Generate" produces (or returns the
 * cached) management report for the current week; the insights bot writes it
 * from the same deterministic metrics the other views chart, with detected
 * anomalies injected as input it must address. Regeneration is freshness-
 * gated server-side; "Regenerate" forces it.
 */
export function ReportsView({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data: allReports = [], isPending } = useQuery(
    insightReportsQueryOptions(propertyId),
  );
  // Managers see both audiences via RLS; this archive is the management
  // edition (the staff variant renders inside staff "My week").
  const reports = allReports.filter((r) => r.audience === "management");
  const [openId, setOpenId] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: async (force: boolean) => {
      const res = await fetch(`/api/properties/${propertyId}/insights/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { report: InsightReportRow; cached: boolean };
    },
    onSuccess: ({ report, cached }) => {
      qc.invalidateQueries({ queryKey: ["insights", propertyId, "reports"] });
      setOpenId(report.id);
      toast.success(
        cached
          ? "This week's report is already current."
          : "This week's report is ready.",
      );
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Report generation failed"),
  });

  const current = reports[0];

  return (
    <InsightSection
      kicker="AI briefing"
      title="Weekly reports"
      wide
      headerRight={
        <>
          {current ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={generate.isPending}
              onClick={() => generate.mutate(true)}
              title="Regenerate this week's report from current data"
            >
              <Gi
                icon={RefreshCw}
                size={13}
                className={generate.isPending ? "animate-spin" : undefined}
              />
              Regenerate
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={generate.isPending}
            onClick={() => generate.mutate(false)}
          >
            <Gi
              icon={generate.isPending ? Loader2 : Sparkles}
              size={13}
              className={generate.isPending ? "animate-spin" : undefined}
            />
            {generate.isPending ? "Writing…" : "Generate this week's report"}
          </button>
        </>
      }
    >
      {isPending ? (
        <div className="flex flex-col gap-2 py-4" aria-busy="true">
          <span className="sk" style={{ height: 14, width: "60%" }} />
          <span className="sk" style={{ height: 14, width: "40%" }} />
        </div>
      ) : reports.length === 0 ? (
        <G8Note>
          No reports yet. Generate the first one — the analyst reads the same
          numbers these dashboards chart and writes the week up in a minute.
        </G8Note>
      ) : (
        <G8Rows>
          {reports.map((report, i) => (
            <ReportRow
              key={report.id}
              report={report}
              open={openId ? openId === report.id : i === 0}
              onToggle={() =>
                setOpenId((prev) => (prev === report.id ? "" : report.id))
              }
            />
          ))}
        </G8Rows>
      )}
    </InsightSection>
  );
}

function ReportRow({
  report,
  open,
  onToggle,
}: {
  report: InsightReportRow;
  open: boolean;
  onToggle: () => void;
}) {
  const period = `${shortDate(report.period_start)} – ${shortDate(report.period_end)}`;
  return (
    <article>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mini"
        style={{ width: "100%", background: "transparent", textAlign: "left" }}
      >
        <span className="faint" style={{ display: "inline-flex" }}>
          <Gi icon={FileText} size={14} />
        </span>
        <span className="tt" style={{ fontWeight: 500 }}>
          Week of {period}
        </span>
        {report.anomalies.length > 0 ? (
          <span className="badge amber">
            {report.anomalies.length}{" "}
            {report.anomalies.length === 1 ? "anomaly" : "anomalies"}
          </span>
        ) : null}
        <span className="m">{open ? "Hide" : "Read"}</span>
      </button>
      {open ? (
        <div style={{ padding: "4px 14px 20px" }}>
          <ReportMarkdown>{report.summary_md}</ReportMarkdown>
        </div>
      ) : null}
    </article>
  );
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
