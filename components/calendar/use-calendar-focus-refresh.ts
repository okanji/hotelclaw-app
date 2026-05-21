"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConnectionRow } from "@/lib/calendar/types";

const REFRESH_INTERVAL_MS = 5 * 60_000;
const MIN_TIME_BETWEEN_REFRESHES_MS = 60_000;

/**
 * Kick the sync endpoint for each connection at most once every 5 min,
 * but only while the page is visible. Without this, external changes made
 * elsewhere don't show up in our calendar until the user clicks Refresh.
 *
 * The check fires on:
 *   * Initial mount (so opening the calendar tab pulls fresh data)
 *   * Tab focus (so coming back from another tab pulls fresh data)
 *   * Interval — but only when visible
 *
 * A `lastRefresh` ref dedupes back-to-back triggers; if mount + focus both
 * fire within 60s, only the first one actually hits the network.
 */
export function useCalendarFocusRefresh(
  propertyId: string,
  connections: ConnectionRow[],
): void {
  const qc = useQueryClient();
  const lastRefreshRef = useRef(0);

  // Stash connections in a ref so the effect doesn't re-subscribe every
  // time the React Query cache hands us a freshly-frozen array.
  const connectionsRef = useRef(connections);
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  useEffect(() => {
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_TIME_BETWEEN_REFRESHES_MS) return;
      lastRefreshRef.current = now;

      const conns = connectionsRef.current;
      if (conns.length === 0) return;
      await Promise.allSettled(
        conns.map((c) =>
          fetch(`/api/calendar/${c.provider}/sync?connectionId=${c.id}`, {
            method: "POST",
          }),
        ),
      );
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      qc.invalidateQueries({ queryKey: ["calendar-sources"] });
    }

    refresh();
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [propertyId, qc]);
}
