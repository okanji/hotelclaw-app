"use client";

import { useCallback, useEffect, useId, useMemo } from "react";
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

/**
 * Read-state actions over the shared `["notifications", userId]` cache,
 * optimistically updated then persisted via `/mark-read`. Shared by the
 * Activity sidebar nav (mark-all-read) and the main-pane feed (mark-on-open) so
 * both stay in sync against one cache entry.
 */
export function useNotificationActions(userId: string) {
  const qc = useQueryClient();

  const markSeen = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      qc.setQueryData<NotificationRow[]>(["notifications", userId], (prev) =>
        (prev ?? []).map((n) =>
          idSet.has(n.id) && !n.seen_at ? { ...n, seen_at: now } : n,
        ),
      );
    },
    [qc, userId],
  );

  /** Optimistically mark one row seen and persist it — no navigation. */
  const markRead = useCallback(
    (n: NotificationRow) => {
      if (n.seen_at) return;
      markSeen([n.id]);
      void fetch("/api/me/notifications/mark-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => {});
    },
    [markSeen],
  );

  const markAllRead = useCallback(() => {
    const current =
      qc.getQueryData<NotificationRow[]>(["notifications", userId]) ?? [];
    const unseen = current.filter((n) => !n.seen_at);
    if (unseen.length === 0) return;
    markSeen(unseen.map((n) => n.id));
    void fetch("/api/me/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {
      qc.invalidateQueries({ queryKey: ["notifications", userId] });
    });
  }, [qc, userId, markSeen]);

  return { markSeen, markRead, markAllRead };
}
