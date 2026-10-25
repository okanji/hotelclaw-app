"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { isSameDay, monthGrid } from "@/lib/calendar/time";
import {
  dayDensity,
  dayKey,
  densityLevel,
  viewRange,
  yearMonths,
} from "@/lib/calendar/view-range";
import type { CalendarEvent } from "@/lib/calendar/types";

// Marker strength per density level — one hue (the selection blue) at three
// opacities, so "busier" reads as "darker" without inventing a status scale.
const LEVEL_CLASS = ["", "bg-primary/35", "bg-primary/65", "bg-primary"] as const;

/**
 * Year view: twelve compact month grids with a density dot under every day
 * that has events, bookings, or due tasks — the same filtered feed the other
 * views render, so hidden calendars drop out here too. Clicking a day opens
 * Day view on it (delegated up). Spill-over days from adjacent months render
 * blank so each block reads as exactly one month.
 */
export function YearGrid({
  focusDate,
  events,
  onSelectDay,
}: {
  focusDate: Date;
  events: CalendarEvent[];
  onSelectDay: (d: Date) => void;
}) {
  const year = focusDate.getFullYear();
  const months = useMemo(() => yearMonths(new Date(year, 0, 1)), [year]);
  const density = useMemo(
    () => dayDensity(events, viewRange("year", new Date(year, 0, 1))),
    [events, year],
  );
  const today = new Date();
  // Weekday initials from the first grid row, so they follow WEEK_START.
  const weekdays = monthGrid(months[0])
    .slice(0, 7)
    .map((d) => d.toLocaleDateString(undefined, { weekday: "narrow" }));

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 pt-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {months.map((month) => {
          const m = month.getMonth();
          return (
            <section key={m} aria-label={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}>
              <h2 className="px-1 pb-1.5 text-sm font-semibold text-foreground">
                {month.toLocaleDateString(undefined, { month: "long" })}
              </h2>
              <div className="grid grid-cols-7 text-center text-xs text-faint-foreground">
                {weekdays.map((w, i) => (
                  <span key={i} className="py-1">
                    {w}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {monthGrid(month).map((d) => {
                  if (d.getMonth() !== m) {
                    return <span key={d.toISOString()} aria-hidden className="h-8" />;
                  }
                  const count = density.get(dayKey(d)) ?? 0;
                  const level = densityLevel(count);
                  const isToday = isSameDay(d, today);
                  const label = d.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  });
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      onClick={() => onSelectDay(d)}
                      aria-label={
                        count > 0
                          ? `${label}, ${count} item${count === 1 ? "" : "s"}`
                          : label
                      }
                      title={count > 0 ? `${count} item${count === 1 ? "" : "s"}` : undefined}
                      className={cn(
                        "relative flex h-8 flex-col items-center justify-center rounded-md text-xs tabular-nums transition-colors hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none",
                        isToday
                          ? "font-semibold text-primary"
                          : "text-secondary-ink",
                      )}
                    >
                      <span>{d.getDate()}</span>
                      <span
                        aria-hidden
                        className={cn(
                          "absolute bottom-1 size-1 rounded-full",
                          LEVEL_CLASS[level],
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
