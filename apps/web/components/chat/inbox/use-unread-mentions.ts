"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/notifications/types";

/**
 * Unseen-mentions count, derived from our notifications table.
 *
 * Why this and not Stream's `total_unread_count`?
 *   - Stream counts EVERY unread message (including non-mention DMs and
 *     channel chatter), so the badge would disagree with the inbox page,
 *     which only lists mentions.
 *   - Stream's count only decreases when you actually read each channel —
 *     visiting /inbox wouldn't clear it.
 *
 * The notifications table is the source of truth: `<ChatEventNotifier>`
 * inserts a `mention` row on every message.new event where the current user
 * is in `mentioned_users`, and `markMentionsSeen()` flips them to seen.
 *
 * Shares a query key with the bell so realtime updates land in one fetch.
 */
export function useUnseenMentionsCount(userId: string): number {
  const { data = [] } = useQuery<NotificationRow[]>({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const r = await fetch("/api/me/notifications?limit=50", {
        cache: "no-store",
      });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 10_000,
    enabled: !!userId,
  });

  return data.filter((n) => n.type === "mention" && !n.seen_at).length;
}

/**
 * Marks every unseen mention as read. Called when the inbox page mounts so
 * the sidebar badge clears as soon as the user opens the feed.
 */
export function useMarkMentionsSeenOnMount(userId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function run() {
      // Read current state from cache (or fetch if missing).
      const current = qc.getQueryData<NotificationRow[]>([
        "notifications",
        userId,
      ]);
      const list =
        current ??
        (await fetch("/api/me/notifications?limit=50", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [] as NotificationRow[]));
      const ids = (list as NotificationRow[])
        .filter((n) => n.type === "mention" && !n.seen_at)
        .map((n) => n.id);
      if (ids.length === 0 || cancelled) return;

      // Optimistic: flip seen_at locally so the badge clears immediately.
      qc.setQueryData<NotificationRow[]>(["notifications", userId], (prev) =>
        (prev ?? []).map((n) =>
          ids.includes(n.id) ? { ...n, seen_at: new Date().toISOString() } : n,
        ),
      );

      await fetch("/api/me/notifications/mark-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      }).catch(() => {});
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [userId, qc]);
}

/**
 * Wires realtime + initial fetch for the notifications query so this hook
 * gets fresh data even on pages that don't mount the bell (the bell already
 * subscribes; if it's mounted, this becomes a no-op via shared subscription).
 */
export function useNotificationsRealtime(userId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-mentions:${userId}:${Math.random().toString(36).slice(2)}`)
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
  }, [userId, qc]);
}
