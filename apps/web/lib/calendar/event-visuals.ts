import type { CalendarEvent } from "@/lib/calendar/types";

/**
 * Single source of truth for event-source colors on the calendar.
 *
 *   meeting = blue · task = amber · booking = violet ·
 *   external google = emerald · external microsoft = indigo
 *
 * Week grid (block tint), month grid (chip), and the details dialog (swatch/
 * dot) must all derive from this map — before it existed the details chip
 * had no booking branch and painted bookings indigo while the grids said
 * violet. An explicit `event.color` still overrides at the call site.
 */
type EventSourceKey = "meeting" | "task" | "booking" | "google" | "microsoft";

export function eventSourceKey(event: CalendarEvent): EventSourceKey {
  if (event.source === "meeting") return "meeting";
  if (event.source === "task") return "task";
  if (event.source === "booking") return "booking";
  return event.provider === "google" ? "google" : "microsoft";
}

export const EVENT_VISUALS: Record<
  EventSourceKey,
  { block: string; chip: string; dot: string; swatch: string }
> = {
  meeting: {
    block:
      "border-l-blue-500 bg-blue-500/10 text-blue-900 ring-blue-500/20 dark:text-blue-100",
    chip: "bg-blue-500/15 text-blue-900 dark:text-blue-100",
    dot: "bg-blue-500",
    swatch: "var(--color-blue-500)",
  },
  task: {
    block:
      "border-l-amber-500 bg-amber-500/10 text-amber-900 ring-amber-500/20 dark:text-amber-100",
    chip: "bg-amber-500/15 text-amber-900 dark:text-amber-100",
    dot: "bg-amber-500",
    swatch: "var(--color-amber-500)",
  },
  booking: {
    block:
      "border-l-violet-500 bg-violet-500/10 text-violet-900 ring-violet-500/20 dark:text-violet-100",
    chip: "bg-violet-500/15 text-violet-900 dark:text-violet-100",
    dot: "bg-violet-500",
    swatch: "var(--color-violet-500)",
  },
  google: {
    block:
      "border-l-emerald-500 bg-emerald-500/10 text-emerald-900 ring-emerald-500/20 dark:text-emerald-100",
    chip: "bg-emerald-500/15 text-emerald-900 dark:text-emerald-100",
    dot: "bg-emerald-500",
    swatch: "var(--color-emerald-500)",
  },
  microsoft: {
    block:
      "border-l-indigo-500 bg-indigo-500/10 text-indigo-900 ring-indigo-500/20 dark:text-indigo-100",
    chip: "bg-indigo-500/15 text-indigo-900 dark:text-indigo-100",
    dot: "bg-indigo-500",
    swatch: "var(--color-indigo-500)",
  },
};

export function eventTint(event: CalendarEvent): string {
  return EVENT_VISUALS[eventSourceKey(event)].block;
}

export function eventChipClass(event: CalendarEvent): string {
  return EVENT_VISUALS[eventSourceKey(event)].chip;
}

export function eventDotClass(event: CalendarEvent): string {
  return EVENT_VISUALS[eventSourceKey(event)].dot;
}

/** The colour swatch next to a title — explicit colour beats source tint. */
export function eventSwatch(event: CalendarEvent): string {
  if (event.color) return `#${event.color}`;
  return EVENT_VISUALS[eventSourceKey(event)].swatch;
}
