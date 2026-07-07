"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Push-based freshness for the workflows section. Subscribes to the
 * `workflows` and `workflow_runs` tables (scoped to this property) and
 * invalidates the relevant React Query caches on any change — so a run that
 * lands, a status that flips, or a toggle from another tab updates the list
 * without polling. Mirrors `use-calendar-realtime.ts`: one channel, several
 * `.on` listeners sharing its socket, `removeChannel` on unmount.
 */
export function useWorkflowsRealtime(propertyId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId) return;
    const supabase = createClient();
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["workflows", propertyId] });
      qc.invalidateQueries({ queryKey: ["all-workflow-runs", propertyId] });
      // Prefix match — covers every ["workflow-runs", propertyId, <id>] key.
      qc.invalidateQueries({ queryKey: ["workflow-runs", propertyId] });
    };
    const channel = supabase
      .channel(`workflows:${propertyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflows",
          filter: `property_id=eq.${propertyId}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_runs",
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
