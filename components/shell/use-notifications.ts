"use client";

import { useEffect, useId, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/notifications/types";

/**
 * Shared notifications feed: the React Query fetch + a Supabase Realtime
 * subscription that refetches on any change for this user.
 *
 * Used by the rail (for the Activity unseen badge) and the Activity view.
 * The query is keyed by `["notifications", userId]` so every consumer shares
 * one cache entry; the realtime topic is suffixed with a per-instance id so
 * multiple mounts don't collide on the same channel name.
 */
export function useNotifications(userId: string) {
  const qc = useQueryClient();
  const instanceId = useId();

  const query = useQuery<NotificationRow[]>({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const r = await fetch("/api/me/notifications?limit=100", {
        cache: "no-store",
      });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications", userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, instanceId, qc]);

  const notifications = useMemo(() => query.data ?? [], [query.data]);
  const unseenCount = useMemo(
    () => notifications.filter((n) => !n.seen_at).length,
    [notifications],
  );

  return { notifications, unseenCount, isLoading: query.isLoading };
}
