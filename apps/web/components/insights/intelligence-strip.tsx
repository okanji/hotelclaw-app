"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  OctagonAlert,
  PartyPopper,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { relativeShort } from "@/components/home/editorial-section";
import { Gi } from "@/components/gr8r/icon";
import { G8Note } from "./g8-insights";
import type { InsightsMetrics } from "@/lib/insights/metrics";
import type { InsightCard } from "@/lib/ai/bots/insights-bot";
import { insightsBriefQueryOptions } from "@/lib/query/insights-queries";
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
    <span className="faint num" style={{ fontSize: "var(--g8-fs-xs)" }}>
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
 *
 * Cards render in a header-paged carousel (page counter + ‹ › chevrons,
 * sliding transition, ←/→ when the region is focused). Deliberately NO
 * autoplay — this is a dashboard, not a demo.
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
      <G8Note>
        The analyst is still reading this lens — the first brief takes a
        little while and will appear here as soon as it&apos;s ready.
      </G8Note>
    ) : (
      <BriefSkeleton />
    );
  }
  if (!data.brief) {
    return (
      <G8Note>
        The analyst hasn&apos;t written anything yet — insights appear here
        automatically once there&apos;s task activity to read.
      </G8Note>
    );
  }
  return (
    <InsightCarousel
      propertyId={propertyId}
      cards={data.brief.insights as InsightCard[]}
      flow={metrics.flow}
    />
  );
}

/**
 * Header-paged carousel over the brief cards: "Insights · N of M" plus ‹ ›
 * chevrons, a sliding track underneath. 1 card per page, 2 side-by-side once
 * the container passes the old @3xl grid breakpoint (48rem, measured with a
 * ResizeObserver since the page math needs the count in JS). All cards live
 * on one stretched flex track, so every card shares the tallest card's
 * height and bottoms align across pages.
 */
function InsightCarousel({
  propertyId,
  cards,
  flow,
}: {
  propertyId: string;
  cards: InsightCard[];
  flow: InsightsMetrics["flow"];
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(1);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // 48rem = the @3xl container breakpoint the old grid used.
    const update = () => setPerPage(el.clientWidth >= 768 ? 2 : 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageCount = Math.max(1, Math.ceil(cards.length / perPage));
  const current = Math.min(page, pageCount - 1);
  const move = (dir: -1 | 1) =>
    setPage((current + dir + pageCount) % pageCount);

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label="Intelligence brief"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          move(1);
        }
      }}
      className="focus-visible:outline-none"
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="row" style={{ gap: 6, alignItems: "baseline" }}>
          <span className="eyebrow">Insights</span>
          <span aria-live="polite" className="faint num" style={{ fontSize: "var(--g8-fs-xs)" }}>
            {current + 1} of {pageCount}
          </span>
        </span>
        <span className="sp" />
        <button
          type="button"
          aria-label="Previous insights"
          disabled={pageCount <= 1}
          onClick={() => move(-1)}
          className="ibtn ibtn-sm"
        >
          <Gi icon={ChevronLeft} size={14} />
        </button>
        <button
          type="button"
          aria-label="Next insights"
          disabled={pageCount <= 1}
          onClick={() => move(1)}
          className="ibtn ibtn-sm"
        >
          <Gi icon={ChevronRight} size={14} />
        </button>
      </div>
      <div ref={viewportRef} className="-mx-2 -my-4 overflow-hidden py-4">
        <div
          className="flex items-stretch transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {cards.map((card, i) => {
            const offscreen = Math.floor(i / perPage) !== current;
            return (
              <div
                key={i}
                className="shrink-0 grow-0 px-2"
                style={{ width: `${100 / perPage}%` }}
                aria-hidden={offscreen || undefined}
                inert={offscreen || undefined}
              >
                <InsightCardRow
                  propertyId={propertyId}
                  card={card}
                  flow={flow}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BriefSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-4 @3xl:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="ins-card" style={{ flexDirection: "column", gap: 8 }}>
          <span className="sk" style={{ height: 16, width: "75%" }} />
          <span className="sk" style={{ height: 12, width: "100%" }} />
          <span className="sk" style={{ height: 12, width: "66%" }} />
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

/**
 * The 8-week flow sparkline with a real hover readout: a manual pointer →
 * index calc over the known series length (recharts Tooltip is fiddly at
 * this size), a hairline cursor at the hovered week, and a floating dark
 * pill (tooltip tokens) naming the point's value + week.
 */
function Sparkline({
  spark,
  flow,
}: {
  spark: Exclude<InsightCard["spark"], "none">;
  flow: InsightsMetrics["flow"];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = flow.length;
  const stroke = spark === "done" ? COLOR.done : COLOR.series3;
  const word = spark === "done" ? "completed" : "created";
  const point = hover !== null ? flow[hover] : undefined;
  return (
    <div
      className="relative h-7 w-20 shrink-0 cursor-crosshair"
      onMouseMove={(e) => {
        if (n < 2) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const p = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / rect.width),
        );
        setHover(Math.round(p * (n - 1)));
      }}
      onMouseLeave={() => setHover(null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={flow} margin={{ top: 3, right: 0, bottom: 3, left: 0 }}>
          <Line
            type="monotone"
            dataKey={spark}
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {hover !== null && point ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px"
            style={{
              left: `${(hover / (n - 1)) * 100}%`,
              background: "var(--g8-border-strong)",
            }}
          />
          <span className="pointer-events-none absolute right-0 bottom-full z-10 mb-1.5 flex items-center gap-1.5 rounded-md bg-tooltip-bg px-2 py-1 text-xs whitespace-nowrap text-tooltip-foreground shadow-tooltip">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: stroke }}
            />
            <span className="font-medium tabular-nums">{point[spark]}</span>
            <span>{word}</span>
            <span className="opacity-70">· {point.label}</span>
          </span>
        </>
      ) : null}
    </div>
  );
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
  const iconTone =
    card.severity === "critical"
      ? "var(--g8-red)"
      : card.severity === "warning"
        ? "var(--g8-amber)"
        : card.kind === "win"
          ? "var(--g8-green)"
          : "var(--g8-text-3)";
  return (
    <article className="ins-card">
      <span style={{ color: iconTone, display: "inline-flex", marginTop: 2 }}>
        <Gi icon={Icon} size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0">{card.headline}</h3>
          {card.spark !== "none" ? (
            <Sparkline spark={card.spark} flow={flow} />
          ) : null}
        </div>
        <p>{card.detail}</p>
        {card.evidence ? (
          <figure className="ins-quote">
            <blockquote>“{card.evidence.quote}”</blockquote>
            <figcaption>{card.evidence.source}</figcaption>
          </figure>
        ) : null}
        {card.action ? (
          <Link
            href={actionHref(propertyId, card.action)}
            className="link row"
            style={{ gap: 4, width: "fit-content", fontWeight: 500, fontSize: "var(--g8-fs-sm)" }}
          >
            {card.action.label}
            <Gi icon={ArrowRight} size={12} />
          </Link>
        ) : null}
        {card.basis && card.basis.length > 0 ? (
          <details className="ins-basis">
            <summary>
              <Gi icon={ChevronRight} size={12} />
              From {card.basis.length} deterministic signal
              {card.basis.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {card.basis.map((b, i) => (
                <li key={i}>· {b}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}
