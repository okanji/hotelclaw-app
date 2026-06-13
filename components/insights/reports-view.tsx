"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WidgetEmpty } from "@/components/home/editorial-section";
import { insightReportsQueryOptions } from "@/lib/query/insights-queries";
import type { InsightReportRow } from "@/lib/ai/bots/insights-bot";
import { cn } from "@/lib/utils";
import { InsightSection } from "./insights-view";
import { ReportMarkdown } from "./report-markdown";

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
        <div className="flex items-center gap-2">
          {current ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={generate.isPending}
              onClick={() => generate.mutate(true)}
              title="Regenerate this week's report from current data"
            >
              <RefreshCw
                className={cn("size-3.5", generate.isPending && "animate-spin")}
              />
              Regenerate
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={generate.isPending}
            onClick={() => generate.mutate(false)}
          >
            {generate.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {generate.isPending ? "Writing…" : "Generate this week's report"}
          </Button>
        </div>
      }
    >
      {isPending ? (
        <WidgetEmpty>Loading reports…</WidgetEmpty>
      ) : reports.length === 0 ? (
        <WidgetEmpty>
          No reports yet. Generate the first one — the analyst reads the same
          numbers these dashboards chart and writes the week up in a minute.
        </WidgetEmpty>
      ) : (
        <div className="flex flex-col divide-y divide-border/40 border-t border-border/40">
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
        </div>
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
    <article className="py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-1 py-2.5 text-left"
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-foreground">
          Week of {period}
        </span>
        {report.anomalies.length > 0 ? (
          <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-600 dark:text-amber-500">
            {report.anomalies.length}{" "}
            {report.anomalies.length === 1 ? "anomaly" : "anomalies"}
          </span>
        ) : null}
        <span className="shrink-0 text-[0.75rem] text-muted-foreground">
          {open ? "Hide" : "Read"}
        </span>
      </button>
      {open ? (
        <div className="px-1 pb-5">
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
