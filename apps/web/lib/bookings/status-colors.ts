import type { BookingStatus } from "@/lib/db/types";

/**
 * Single source of truth for booking-status color treatments.
 *
 *   pending = amber (warning) · confirmed = blue (info) · seated = violet
 *   completed/cancelled = neutral · no_show = red
 *
 * Four surfaces render status (badge, agenda left-accent, timetable block,
 * floor-plan table tone) — they must all derive from this map. Before this
 * existed the badge said emerald for "confirmed" while the floor plan and
 * timetable said blue.
 */
export const BOOKING_STATUS_UI: Record<
  BookingStatus,
  { badge: string; accent: string; block: string; tone: string }
> = {
  pending: {
    badge: "border-warning/30 bg-warning/10 text-warning",
    accent: "border-l-amber-500",
    block:
      "border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-200",
    tone: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  confirmed: {
    badge: "border-info/30 bg-info/10 text-info",
    accent: "border-l-blue-500",
    block:
      "border-blue-500/60 bg-blue-500/15 text-blue-800 dark:text-blue-200",
    tone: "border-blue-500/60 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  seated: {
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
    accent: "border-l-violet-500",
    block:
      "border-violet-500/70 bg-violet-500/20 text-violet-800 dark:text-violet-200",
    tone: "border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  completed: {
    badge: "",
    accent: "border-l-border",
    block: "border-border bg-muted text-muted-foreground",
    tone: "border-border bg-muted/30 text-muted-foreground",
  },
  cancelled: {
    badge: "",
    accent: "border-l-border",
    block: "border-border bg-muted/50 text-muted-foreground line-through",
    tone: "border-border bg-muted/30 text-muted-foreground",
  },
  no_show: {
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    accent: "border-l-red-400",
    block:
      "border-red-500/50 bg-red-500/10 text-red-700 line-through dark:text-red-300",
    tone: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  },
};
