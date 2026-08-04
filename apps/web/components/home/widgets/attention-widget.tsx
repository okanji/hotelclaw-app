"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { insightsMetricsQueryOptions } from "@/lib/query/insights-queries";
import { AttentionList } from "@/components/insights/pulse-view";
import { WidgetEmpty } from "../editorial-section";

/**
 * Needs attention — blocked (with days stuck), overdue, and unassigned
 * urgent work, straight from the Insights metrics endpoint. Role-shaped at
 * the API: managers see the whole property, staff see their own items. The
 * one dashboard section that converts "things feel stuck" into named, aged,
 * owned items.
 */
export function AttentionWidget({ propertyId }: { propertyId: string }) {
  const { data, isPending } = useQuery(insightsMetricsQueryOptions(propertyId));

  if (isPending || !data)
    return <WidgetEmpty>Checking for stuck work…</WidgetEmpty>;

  const items = data.attention;
  if (items.length === 0)
    return (
      <WidgetEmpty>
        Nothing stuck — no blocked, overdue, or unassigned urgent work.
      </WidgetEmpty>
    );

  return (
    <div className="flex flex-col gap-3">
      <AttentionList propertyId={propertyId} items={items.slice(0, 6)} />
      <Link
        href={`/p/${propertyId}/home/insights`}
        className="self-start text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {items.length > 6 ? `All ${items.length} in Insights →` : "Open Insights →"}
      </Link>
    </div>
  );
}
