"use client";

import { useMemo } from "react";
import { isSameDay, monthGrid } from "@/lib/calendar/time";
import {
  dayDensity,
  dayKey,
  densityLevel,
  viewRange,
  yearMonths,
} from "@/lib/calendar/view-range";
import type { CalendarEvent } from "@/lib/calendar/types";

// Marker strength per density level — gr8r's accent at three strengths
// (`.yr-d i.l1/.l2/.l3` in gr8r-ext.css), so "busier" reads as "darker"
// without inventing a status scale.
const LEVEL_CLASS = ["", "l1", "l2", "l3"] as const;

/**
 * Year view: twelve compact month grids with a density dot under every day
 * that has events or due tasks — the same filtered feed the other
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
    // gr8r has no year view; this is twelve gr8r-styled mini months
    // (`.yr*` in gr8r-ext.css) on the same tokens as the `.cal` month.
    <div className="yr">
      <div className="yr-grid">
        {months.map((month) => {
          const m = month.getMonth();
          return (
            <section
              key={m}
              className="yr-m"
              aria-label={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            >
              <h3>{month.toLocaleDateString(undefined, { month: "long" })}</h3>
              <div className="yr-wd">
                {weekdays.map((w, i) => (
                  <span key={i}>{w}</span>
                ))}
              </div>
              <div className="yr-days">
                {monthGrid(month).map((d) => {
                  if (d.getMonth() !== m) {
                    return <span key={d.toISOString()} aria-hidden style={{ height: 30 }} />;
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
                      aria-current={isToday ? "date" : undefined}
                      aria-label={
                        count > 0
                          ? `${label}, ${count} item${count === 1 ? "" : "s"}`
                          : label
                      }
                      title={count > 0 ? `${count} item${count === 1 ? "" : "s"}` : undefined}
                      className={isToday ? "yr-d today" : "yr-d"}
                    >
                      {d.getDate()}
                      {level > 0 ? <i aria-hidden className={LEVEL_CLASS[level]} /> : null}
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
