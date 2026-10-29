"use client";

import type { CSSProperties } from "react";
import { eventSourceKey } from "@/lib/calendar/event-visuals";
import type { CalendarEvent } from "@/lib/calendar/types";

/**
 * gr8r calendar helpers (src/views/calendar.js) over OUR event shapes.
 *
 * gr8r tints every chip with its project's `--c`; our calendar's identity is
 * the event SOURCE (meeting / task / Google / Microsoft — see
 * `lib/calendar/event-visuals.ts`), so each source maps onto one gr8r palette
 * token and an explicit `event.color` (user / provider data) still wins.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export const SOURCE_G8: Record<
  "meeting" | "task" | "google" | "microsoft",
  string
> = {
  meeting: "var(--g8-blue)",
  task: "var(--g8-amber)",
  google: "var(--g8-green)",
  microsoft: "var(--g8-gray)",
};

export const SOURCE_LABEL: Record<keyof typeof SOURCE_G8, string> = {
  meeting: "Meetings",
  task: "Tasks",
  google: "Google",
  microsoft: "Microsoft",
};

/** The `--g8-c` colour for one event. */
export function eventG8Color(event: CalendarEvent): string {
  if (event.color) return `#${event.color}`;
  return SOURCE_G8[eventSourceKey(event)];
}

/** `style={{"--g8-c": …}}` for an element tinted by an event. */
export function evStyle(event: CalendarEvent, extra?: CSSProperties): CSSVars {
  return { "--g8-c": eventG8Color(event), ...extra } as CSSVars;
}

/** `style={{"--g8-c": c}}` for an arbitrary colour. */
export function g8c(c: string, extra?: CSSProperties): CSSVars {
  return { "--g8-c": c, ...extra } as CSSVars;
}

/** gr8r's `.cev` time prefix ("9:30") — short, no AM/PM noise when on the hour. */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
