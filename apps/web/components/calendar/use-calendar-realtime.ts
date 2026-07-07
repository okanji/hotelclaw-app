"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to the three tables the calendar reads from and invalidate the
 * `["calendar-events", propertyId, …]` cache on any change. Mirrors the
 * pattern used in chat/notifications (`use-unread-mentions.ts`) — push via
 * Supabase Realtime, refetch via React Query. No polling.
 *
 * One channel is enough: postgres_changes filters happen on the server side,
 * and three `.on` listeners share that channel's WebSocket connection.
 */
export function useCalendarRealtime(propertyId: string, userId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId || !userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`calendar:${propertyId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meetings",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meeting_attendees" },
        () => {
          qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "external_events" },
        () => {
          qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [propertyId, userId, qc]);
}
