"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Push-based freshness for the Insights section. Subscribes to `tasks` and
 * `insight_reports` (scoped to this property) and prefix-invalidates the
 * `["insights", propertyId]` cache on any change. Deliberately NOT subscribed
 * to `workflow_events` — it fires on every task touch and would invalidate
 * constantly; the 30s `staleTime` on the metrics query covers the gap.
 * Mirrors `lib/workflows/use-workflows-realtime.ts`.
 */
export function useInsightsRealtime(propertyId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId) return;
    const supabase = createClient();
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["insights", propertyId] });
    };
    const channel = supabase
      .channel(`insights:${propertyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `property_id=eq.${propertyId}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "insight_reports",
          filter: `property_id=eq.${propertyId}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "insight_briefs",
          filter: `property_id=eq.${propertyId}`,
        },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);
}
