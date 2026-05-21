import { queryOptions } from "@tanstack/react-query";
import type { CalendarEvent, CalendarSource, ConnectionRow } from "./types";

/**
 * Event window query — keyed on the rounded `[from, to)` ISO pair. The grid
 * passes the start of week (Mon 00:00) and the start of the next week, so
 * scrolling/paging through weeks gets cache hits on revisits without
 * re-fetching the same range.
 */
export function calendarEventsQueryOptions(
  propertyId: string,
  range: { from: string; to: string },
) {
  return queryOptions({
    queryKey: ["calendar-events", propertyId, range.from, range.to] as const,
    queryFn: async (): Promise<CalendarEvent[]> => {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(
        `/api/properties/${propertyId}/calendar?${params}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load calendar events");
      return res.json();
    },
  });
}

/** User-level connection + source list. Shared between sidebar + dialog. */
export function calendarSourcesQueryOptions() {
  return queryOptions({
    queryKey: ["calendar-sources"] as const,
    queryFn: async (): Promise<{
      connections: ConnectionRow[];
      sources: CalendarSource[];
    }> => {
      const res = await fetch(`/api/me/calendar`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load calendar sources");
      return res.json();
    },
  });
}
