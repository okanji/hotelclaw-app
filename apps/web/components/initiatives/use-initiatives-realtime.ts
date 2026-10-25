"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Keep the initiatives list + any open initiative live: both `initiatives` and
 * the `initiative_projects` link table are realtime-published (0111) and carry
 * `property_id`, so one property-filtered channel covers every surface.
 */
export function useInitiativesRealtime(propertyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId) return;
    const supabase = createClient();
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["initiatives", propertyId] });
      qc.invalidateQueries({ queryKey: ["initiative"] });
    };
    const channel = supabase
      .channel(`initiatives:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "initiatives",
          filter: `property_id=eq.${propertyId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "initiative_projects",
          filter: `property_id=eq.${propertyId}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);
}
