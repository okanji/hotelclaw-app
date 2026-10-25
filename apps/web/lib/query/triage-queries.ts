import { useEffect } from "react";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { TriageQueueItem } from "@/lib/tasks/triage-queue";

export type { TriageQueueItem };

// React Query option factories for the triage queue (migration 0111). The
// queue feeds `/triage`; the count feeds the sidebar badge. Both are pushed
// fresh by `useTriageRealtime` (Supabase Realtime on `tasks`), never polled.

export function triageQueueQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["triage", propertyId] as const,
    queryFn: async (): Promise<TriageQueueItem[]> => {
      const res = await fetch(`/api/properties/${propertyId}/triage`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load triage");
      return res.json();
    },
  });
}

/** Pending triage tasks for the property — the sidebar badge number. */
export function triageCountQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["triage-count", propertyId] as const,
    queryFn: async (): Promise<number> => {
      const res = await fetch(`/api/properties/${propertyId}/triage/count`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to count triage");
      const body = (await res.json()) as { count: number };
      return body.count;
    },
    staleTime: 30_000,
  });
}

/** Every cache a triage decision moves: the queue, the badge, the board. */
export function invalidateTriage(
  qc: ReturnType<typeof useQueryClient>,
  propertyId: string,
  opts: { board?: boolean } = {},
) {
  void qc.invalidateQueries({ queryKey: ["triage", propertyId] });
  void qc.invalidateQueries({ queryKey: ["triage-count", propertyId] });
  if (opts.board) void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
}

/**
 * Keep the queue + badge live: any `tasks` change in the property (a guest
 * ticket arriving, a teammate accepting) refetches both. A transition OUT of
 * pending also refreshes the board, so an item accepted elsewhere shows up
 * without a reload. Mount once per surface that shows triage data (the
 * triage page does; the sidebar badge should).
 */
export function useTriageRealtime(propertyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`triage:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `property_id=eq.${propertyId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            invalidateTriage(qc, propertyId);
            return;
          }
          const row = payload.new as {
            triage_state?: string | null;
            triaged_at?: string | null;
          };
          if (row.triage_state === "pending") {
            invalidateTriage(qc, propertyId);
            return;
          }
          // An EXIT from the queue: decided moments ago. Accepted rows keep
          // their state forever, so without the recency check every later
          // edit of a once-triaged task would refetch the board.
          const decidedAt = row.triaged_at ? Date.parse(row.triaged_at) : NaN;
          if (
            (row.triage_state === "accepted" || row.triage_state === "declined") &&
            Date.now() - decidedAt < 30_000
          ) {
            invalidateTriage(qc, propertyId, {
              board: row.triage_state === "accepted",
            });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);
}
