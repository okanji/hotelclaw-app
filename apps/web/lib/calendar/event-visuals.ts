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
 *
 * These five hues are CATEGORY colors — the calendar's whole legibility
 * rests on telling a meeting from a task at a glance, so they stay. What
 * went (docs/notion-spec.md §1/§5) is the stroke: blocks used to carry a
 * `ring-<hue>/20` outline on top of the fill. A block is now a warm tinted
 * FILL plus its 2px left accent edge, nothing else.
 *
 * The hues themselves are drawn from the ENTITY pill family
 * (`--pill-<hue>` / `--pill-<hue>-ink`), NOT the raw tailwind palette. An
 * event source is identity ("this came from Google"), not a lifecycle state,
 * so it belongs to the same family as labels/projects/teams — and the pill
 * tokens are warm-shifted and already theme-aware, so the `dark:` ink
 * variants these used to need are gone (the token flips itself).
 * Microsoft maps to `slate` because the entity family has no indigo; the five
 * sources stay mutually distinct, which is the only property that matters.
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
    block: "border-l-pill-blue-ink bg-pill-blue text-pill-blue-ink",
    chip: "bg-pill-blue text-pill-blue-ink",
    dot: "bg-pill-blue-ink",
    swatch: "var(--pill-blue-ink)",
  },
  task: {
    block: "border-l-pill-amber-ink bg-pill-amber text-pill-amber-ink",
    chip: "bg-pill-amber text-pill-amber-ink",
    dot: "bg-pill-amber-ink",
    swatch: "var(--pill-amber-ink)",
  },
  booking: {
    block: "border-l-pill-violet-ink bg-pill-violet text-pill-violet-ink",
    chip: "bg-pill-violet text-pill-violet-ink",
    dot: "bg-pill-violet-ink",
    swatch: "var(--pill-violet-ink)",
  },
  google: {
    block: "border-l-pill-green-ink bg-pill-green text-pill-green-ink",
    chip: "bg-pill-green text-pill-green-ink",
    dot: "bg-pill-green-ink",
    swatch: "var(--pill-green-ink)",
  },
  microsoft: {
    block: "border-l-pill-slate-ink bg-pill-slate text-pill-slate-ink",
    chip: "bg-pill-slate text-pill-slate-ink",
    dot: "bg-pill-slate-ink",
    swatch: "var(--pill-slate-ink)",
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
