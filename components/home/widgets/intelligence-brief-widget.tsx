"use client";

import { useQuery } from "@tanstack/react-query";
import { insightsMetricsQueryOptions } from "@/lib/query/insights-queries";
import { IntelligenceBody } from "@/components/insights/intelligence-strip";
import { WidgetEmpty } from "../editorial-section";

/**
 * The analyst's read, surfaced on Home for the first time — the owner's "Today"
 * hero. A thin wrapper over the Insights `IntelligenceBody`, which needs the
 * full metrics object and runs the brief query itself (skeleton/empty handled
 * inside). The metrics endpoint is role-shaped: only owners/managers get the
 * full payload, so on the staff shape we render nothing. This is hero-only — it
 * is deliberately NOT in the dashboard registry, so it never becomes a masonry
 * tile for non-owner lenses.
 */
export function IntelligenceBriefWidget({ propertyId }: { propertyId: string }) {
  const { data, isPending } = useQuery(insightsMetricsQueryOptions(propertyId));

  if (isPending || !data) return <WidgetEmpty>Reading the numbers…</WidgetEmpty>;
  if (data.role === "staff") return null;

  return <IntelligenceBody propertyId={propertyId} metrics={data} />;
}
