"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { calendarEventsQueryOptions } from "@/lib/calendar/query-options";
import type { CalendarEvent } from "@/lib/calendar/types";
import { WidgetEmpty } from "../editorial-section";

const DAY_MS = 24 * 60 * 60 * 1000;

const SOURCE_DOT: Record<CalendarEvent["source"], string> = {
  meeting: "bg-violet-500",
  task: "bg-blue-500",
  external: "bg-muted-foreground/50",
  booking: "bg-emerald-500",
};

/** The current user's schedule: today first, then the next few days. Range is
 *  computed in an effect (SSR-safe + stable query key). */
export function YourDayWidget({ propertyId }: { propertyId: string }) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRange({
      from: start.toISOString(),
      to: new Date(start.getTime() + 7 * DAY_MS).toISOString(),
    });
  }, []);

  const { data: events = [], isPending } = useQuery({
    ...calendarEventsQueryOptions(propertyId, range ?? { from: "", to: "" }),
    enabled: !!range,
  });

  const { today, upcoming } = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const cutoff = endOfToday.getTime();
    return {
      today: sorted.filter((e) => new Date(e.start).getTime() <= cutoff),
      upcoming: sorted
        .filter((e) => new Date(e.start).getTime() > cutoff)
        .slice(0, 5),
    };
  }, [events]);

  if (!range || isPending) return <WidgetEmpty>Loading your day…</WidgetEmpty>;
  if (events.length === 0)
    return <WidgetEmpty>Nothing scheduled this week.</WidgetEmpty>;

  return (
    <div className="flex flex-col gap-6">
      <Group label="Today" events={today} emptyText="No events today." />
      {upcoming.length > 0 ? (
        <Group label="Next up" events={upcoming} withDate />
      ) : null}
    </div>
  );
}

function Group({
  label,
  events,
  withDate = false,
  emptyText,
}: {
  label: string;
  events: CalendarEvent[];
  withDate?: boolean;
  emptyText?: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      {events.length === 0 && emptyText ? (
        <p className="text-sm tracking-tight text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border/40 border-t border-border/40"
        >
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-1 py-2.5">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  SOURCE_DOT[e.source],
                )}
                aria-hidden="true"
              />
              <span className="w-16 shrink-0 text-xs tracking-tight text-muted-foreground tabular-nums">
                {e.all_day ? "All day" : formatTime(e.start)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm tracking-tight text-foreground">
                {e.title || "Untitled"}
              </span>
              {withDate ? (
                <span className="shrink-0 text-xs tracking-tight text-muted-foreground tabular-nums">
                  {formatDay(e.start)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
}
