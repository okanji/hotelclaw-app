"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import {
  ArrowRight,
  Eye,
  OctagonAlert,
  PartyPopper,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { relativeShort, WidgetEmpty } from "@/components/home/editorial-section";
import type { InsightsMetrics } from "@/lib/insights/metrics";
import type { InsightCard } from "@/lib/ai/bots/insights-bot";
import {
  insightsBriefQueryOptions,
  insightReportsQueryOptions,
} from "@/lib/query/insights-queries";
import {
  PROPERTY_SCOPE,
  scopeKey,
  type InsightScope,
} from "@/lib/insights/scope";
import { COLOR } from "./chart-style";

const KIND_ICON: Record<InsightCard["kind"], typeof TrendingUp> = {
  trend: TrendingUp,
  risk: OctagonAlert,
  anomaly: TriangleAlert,
  win: PartyPopper,
  watch: Eye,
};

/** Header-right "updated Xm" stamp for the Intelligence section. */
export function IntelligenceUpdated({
  propertyId,
  scope = PROPERTY_SCOPE,
}: {
  propertyId: string;
  scope?: InsightScope;
}) {
  const { data } = useQuery(insightsBriefQueryOptions(propertyId, scope));
  if (!data?.brief) return null;
  return (
    <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
      updated {relativeShort(data.brief.generated_at)}
    </span>
  );
}

/**
 * The analyst's read — automatic intelligence at the top of Insights.
 * Structured insight cards generated server-side from deterministic trend
 * signals (no chat, nothing to ask): severity-tinted claims, supporting
 * detail naming people and projects, an optional sparkline drawn from the
 * REAL flow series the model cited (never model-fabricated points), and a
 * validated deep-link action. Regenerates itself whenever the metrics
 * fingerprint moves; fresh briefs land via realtime. Section content only —
 * the sortable section shell lives in the insights registry grid.
 */
export function IntelligenceBody({
  propertyId,
  metrics,
  scope = PROPERTY_SCOPE,
}: {
  propertyId: string;
  metrics: InsightsMetrics;
  scope?: InsightScope;
}) {
  const { data } = useQuery(insightsBriefQueryOptions(propertyId, scope));
  const key = scopeKey(scope);

  // First generation runs in the background; give it a grace window before
  // swapping the skeleton for an honest "still working" note (the query
  // keeps polling — the brief swaps in whenever it lands). Reset happens at
  // render time when the lens changes, not inside the effect.
  const [grace, setGrace] = useState({ key, over: false });
  if (grace.key !== key) setGrace({ key, over: false });
  const graceOver = grace.key === key && grace.over;
  const pending = !data || data.pending;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(
      () => setGrace((g) => (g.key === key ? { key, over: true } : g)),
      15_000,
    );
    return () => clearTimeout(t);
  }, [pending, key]);

  if (!data || data.pending) {
    return graceOver ? (
      <WidgetEmpty>
        The analyst is still reading this lens — the first brief takes a
        little while and will appear here as soon as it&apos;s ready.
      </WidgetEmpty>
    ) : (
      <BriefSkeleton />
    );
  }
  if (!data.brief) {
    return (
      <WidgetEmpty>
        The analyst hasn&apos;t written anything yet — insights appear here
        automatically once there&apos;s task activity to read.
      </WidgetEmpty>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-5 @3xl:grid-cols-2">
      {(data.brief.insights as InsightCard[]).map((card, i) => (
        <InsightCardRow
          key={i}
          propertyId={propertyId}
          card={card}
          flow={metrics.flow}
        />
      ))}
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-5 @3xl:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function actionHref(propertyId: string, action: NonNullable<InsightCard["action"]>): string {
  switch (action.kind) {
    case "task":
      return `/p/${propertyId}/tasks/${action.id}`;
    case "project":
      return `/p/${propertyId}/projects/${action.id}`;
    case "reports":
      return `/p/${propertyId}/home/insights/reports`;
    default:
      return `/p/${propertyId}/tasks`;
  }
}

function InsightCardRow({
  propertyId,
  card,
  flow,
}: {
  propertyId: string;
  card: InsightCard;
  flow: InsightsMetrics["flow"];
}) {
  const Icon = KIND_ICON[card.kind] ?? Eye;
  const tone =
    card.severity === "critical"
      ? "text-rose-500"
      : card.severity === "warning"
        ? "text-amber-500"
        : card.kind === "win"
          ? "text-emerald-500"
          : "text-muted-foreground";

  return (
    <article className="flex items-start gap-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[0.9375rem] font-semibold tracking-tight text-pretty text-foreground">
            {card.headline}
          </h3>
          {card.spark !== "none" ? (
            <div
              className="h-6 w-16 shrink-0"
              title={`${card.spark === "done" ? "Completed" : "Created"} per week, 8 weeks`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={flow}
                  margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
                >
                  <Line
                    type="monotone"
                    dataKey={card.spark}
                    stroke={card.spark === "done" ? COLOR.done : COLOR.series3}
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
        <p className="text-[0.875rem] leading-relaxed text-pretty text-muted-foreground">
          {card.detail}
        </p>
        {card.evidence ? (
          <figure className="mt-0.5 border-l-2 border-border pl-2.5">
            <blockquote className="text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground italic">
              “{card.evidence.quote}”
            </blockquote>
            <figcaption className="mt-0.5 text-[0.75rem] text-muted-foreground/70">
              {card.evidence.source}
            </figcaption>
          </figure>
        ) : null}
        {card.action ? (
          <Link
            href={actionHref(propertyId, card.action)}
            className="group mt-0.5 inline-flex w-fit items-center gap-1 text-[0.8125rem] font-medium text-foreground underline-offset-2 hover:underline"
          >
            {card.action.label}
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : null}
        {card.basis && card.basis.length > 0 ? (
          <details className="group/basis mt-0.5">
            <summary className="w-fit cursor-pointer list-none text-[0.75rem] text-muted-foreground/70 hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
              From {card.basis.length} deterministic signal
              {card.basis.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {card.basis.map((b, i) => (
                <li
                  key={i}
                  className="text-[0.75rem] leading-relaxed text-muted-foreground/80"
                >
                  · {b}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}

/** Header-right link into the Reports page for the weekly-report section. */
export function AllReportsLink({ propertyId }: { propertyId: string }) {
  return (
    <Link
      href={`/p/${propertyId}/home/insights/reports`}
      className="group inline-flex items-center gap-1 text-[0.75rem] font-medium text-muted-foreground hover:text-foreground"
    >
      All reports
      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Compact teaser for the latest weekly report — the Insights page's
 *  reference into the Reports page. Section content only. */
export function WeeklyReportBody({ propertyId }: { propertyId: string }) {
  const { data: reports = [] } = useQuery(
    insightReportsQueryOptions(propertyId),
  );
  const latest = reports.find((r) => r.audience === "management");
  const headline = latest ? extractHeadline(latest.summary_md) : null;
  const periodStart = latest?.period_start ?? null;
  const periodEnd = latest?.period_end ?? null;

  return (
    <>
      {headline ? (
        <div className="flex flex-col gap-1.5">
          {periodStart && periodEnd ? (
            <p className="text-[0.75rem] text-muted-foreground tabular-nums">
              Week of {shortDate(periodStart)} – {shortDate(periodEnd)}
            </p>
          ) : null}
          <p className="max-w-[65ch] text-[0.8125rem] leading-relaxed text-pretty text-foreground">
            {headline}
          </p>
          <Link
            href={`/p/${propertyId}/home/insights/reports`}
            className="group inline-flex w-fit items-center gap-1 text-[0.75rem] font-medium text-foreground underline-offset-2 hover:underline"
          >
            Read the full report
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      ) : (
        <WidgetEmpty>
          No report yet this week —{" "}
          <Link
            href={`/p/${propertyId}/home/insights/reports`}
            className="underline hover:text-foreground"
          >
            generate one in Reports
          </Link>
          , or wait for Monday&apos;s automatic edition.
        </WidgetEmpty>
      )}
    </>
  );
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** First ~220 chars of the report's Headline section. */
function extractHeadline(md: string): string {
  const match = md.match(/##\s*Headline[^\n]*\n+([\s\S]*?)(?=\n##|$)/i);
  const text = (match?.[1] ?? md).replace(/[#*_>`]/g, "").trim();
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}
