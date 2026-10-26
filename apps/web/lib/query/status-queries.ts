import { useEffect } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  buildCatalog,
  EMPTY_CATALOG,
  type StatusCatalog,
  type StatusCatalogPayload,
} from "@/lib/tasks/statuses";

/**
 * Lists + status pipelines (0114). One query per property, hydrated by the
 * tasks layout prefetch (`getStatusCatalog`) and refetched over realtime —
 * the three tables are in the publication.
 */
export function statusCatalogQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["status-catalog", propertyId] as const,
    queryFn: async (): Promise<StatusCatalogPayload> => {
      const res = await fetch(`/api/properties/${propertyId}/lists`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load lists");
      return res.json();
    },
    staleTime: 60_000,
  });
}

/** The built catalog; `EMPTY_CATALOG` until the payload lands. */
export function useStatusCatalog(propertyId: string): StatusCatalog {
  const { data } = useQuery({
    ...statusCatalogQueryOptions(propertyId),
    select: buildCatalog,
  });
  return data ?? EMPTY_CATALOG;
}

/**
 * Keep the catalog live. Cards read `status_name` off the TASK row, so a
 * status rename also invalidates `["tasks"]` — otherwise the columns rename
 * and the cards keep the old label until their next refetch.
 */
export function useStatusCatalogRealtime(propertyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const supabase = createClient();
    const invalidate = (alsoTasks: boolean) => () => {
      void qc.invalidateQueries({ queryKey: ["status-catalog", propertyId] });
      if (alsoTasks) void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    };
    const channel = supabase
      .channel(`status-catalog:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lists", filter: `property_id=eq.${propertyId}` },
        invalidate(false),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "status_sets", filter: `property_id=eq.${propertyId}` },
        invalidate(false),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "statuses", filter: `property_id=eq.${propertyId}` },
        invalidate(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);
}
