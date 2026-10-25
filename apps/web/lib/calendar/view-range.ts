/**
 * Pure view math for the calendar page: which window a view fetches, how
 * ‹ › pages it, and the per-day density the Year view marks. Kept out of the
 * components so every branch over `CalendarView` lives in one tested place —
 * adding a view means extending the switches here, and `never` checks make a
 * missed one a compile error.
 */
import {
  addDays,
  addMinutes,
  endOfDay,
  endOfWeek,
  MINUTES_PER_DAY,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./time";

export type CalendarView = "day" | "week" | "month" | "year";

export const CALENDAR_VIEWS: readonly CalendarView[] = [
  "day",
  "week",
  "month",
  "year",
] as const;

/** Bare-key shortcuts for the view switcher (Google Calendar's letters). */
export const VIEW_SHORTCUTS: Record<string, CalendarView> = {
  d: "day",
  w: "week",
  m: "month",
  y: "year",
};

/**
 * The `[from, to)` window a view fetches. Month pads ±1 week so the 6-row
 * grid's spill-over days have data; year covers Jan 1 → next Jan 1.
 */
export function viewRange(
  view: CalendarView,
  focus: Date,
): { from: Date; to: Date } {
  switch (view) {
    case "day": {
      const start = startOfDay(focus);
      return { from: start, to: endOfDay(start) };
    }
    case "week":
      return { from: startOfWeek(focus), to: endOfWeek(focus) };
    case "month": {
      const monthStart = startOfMonth(focus);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      return { from: addDays(monthStart, -7), to: addDays(monthEnd, 7) };
    }
    case "year": {
      const from = new Date(focus.getFullYear(), 0, 1);
      return { from, to: new Date(focus.getFullYear() + 1, 0, 1) };
    }
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}

/**
 * Add `months` calendar months, clamping the day so Jan 31 + 1 lands on
 * Feb 28/29 instead of rolling into March (the raw `setMonth` behaviour).
 */
export function addMonthsClamped(d: Date, months: number): Date {
  const out = new Date(d);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDay));
  return out;
}

/** The focus date one ‹ / › step away in `view`. */
export function shiftFocusDate(
  view: CalendarView,
  focus: Date,
  direction: -1 | 1,
): Date {
  switch (view) {
    case "day":
      return addDays(focus, direction);
    case "week":
      return addDays(focus, 7 * direction);
    case "month":
      return addMonthsClamped(focus, direction);
    case "year":
      return addMonthsClamped(focus, 12 * direction);
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}

/** The 12 month starts of the year containing `focus`. */
export function yearMonths(focus: Date): Date[] {
  const y = focus.getFullYear();
  return Array.from({ length: 12 }, (_, m) => new Date(y, m, 1));
}

/** Local-day key used by the density map (matches `Date#toDateString`). */
export function dayKey(d: Date): string {
  return d.toDateString();
}

/**
 * Count how many events touch each local day inside `[from, to)`. A
 * multi-day event counts once on every day it overlaps; an event ending
 * exactly at midnight does not spill into the next day.
 */
export function dayDensity(
  events: ReadonlyArray<{ start: string; end: string }>,
  range: { from: Date; to: Date },
): Map<string, number> {
  const out = new Map<string, number>();
  const rangeFrom = range.from.getTime();
  const rangeTo = range.to.getTime();
  for (const ev of events) {
    const start = new Date(ev.start).getTime();
    const endRaw = new Date(ev.end).getTime();
    if (Number.isNaN(start)) continue;
    // Zero-length / bad ends still mark their start day.
    const end = Number.isNaN(endRaw) || endRaw <= start ? start + 1 : endRaw;
    if (end <= rangeFrom || start >= rangeTo) continue;
    let day = startOfDay(new Date(Math.max(start, rangeFrom)));
    // Bounded by the range, so a malformed year-long event costs ≤366 steps.
    while (day.getTime() < end && day.getTime() < rangeTo) {
      const key = dayKey(day);
      out.set(key, (out.get(key) ?? 0) + 1);
      day = startOfDay(addMinutes(day, MINUTES_PER_DAY + 60));
    }
  }
  return out;
}

/** Marker strength for a day's event count: 0 none, 1 light, 2 busy, 3 packed. */
export function densityLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}
