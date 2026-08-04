import type { BookingStatus } from "@/lib/db/types";

/**
 * Single source of truth for booking-status color treatments.
 *
 *   pending = warning · confirmed = info · seated = violet
 *   completed/cancelled = neutral · no_show = destructive
 *
 * Four surfaces render status (badge, agenda left-accent, timetable block,
 * floor-plan table tone) — they must all derive from this map. Before this
 * existed the badge said emerald for "confirmed" while the floor plan and
 * timetable said blue.
 *
 * Notion language (docs/notion-spec.md §1/§5): a state reads as a warm
 * TINTED FILL plus ink — never a stroke. Only `accent` draws a line, and
 * that is the deliberate 2px status rule on an agenda row. Every hue comes
 * from the semantic ramp in globals.css (violet is the one state color used
 * directly, per DESIGN.md) — no raw palette shades, ever.
 */
export const BOOKING_STATUS_UI: Record<
  BookingStatus,
  { badge: string; accent: string; block: string; tone: string }
> = {
  pending: {
    badge: "bg-warning/10 text-warning",
    accent: "border-l-warning",
    block: "bg-warning/15 text-warning",
    tone: "bg-warning/12 text-warning",
  },
  confirmed: {
    badge: "bg-info/10 text-info",
    accent: "border-l-info",
    block: "bg-info/15 text-info",
    tone: "bg-info/12 text-info",
  },
  seated: {
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    accent: "border-l-violet-500",
    block: "bg-violet-500/18 text-violet-700 dark:text-violet-300",
    tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  completed: {
    badge: "",
    accent: "border-l-border",
    block: "bg-muted text-muted-foreground",
    tone: "bg-muted text-muted-foreground",
  },
  cancelled: {
    badge: "",
    accent: "border-l-border",
    block: "bg-muted text-muted-foreground line-through",
    tone: "bg-muted text-muted-foreground",
  },
  no_show: {
    badge: "bg-destructive/10 text-destructive",
    accent: "border-l-destructive",
    block: "bg-destructive/12 text-destructive line-through",
    tone: "bg-destructive/12 text-destructive",
  },
};
