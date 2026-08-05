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
 * Notion language (docs/notion-spec-v2.md §6): a state is a PILL — the hue at
 * ~16% alpha with the same hue darkened for ink, never a stroke and never a
 * saturated fill. Every fill/ink pair here is a `--pill-*` token pair, so the
 * relationship is defined once in globals.css and inverts correctly on the
 * dark plane with no `dark:` classes in this file. Converting this map is how
 * all four surfaces inherit the pill treatment at once.
 *
 * `accent` — the 2px status rule that used to run down an agenda row — is
 * **retired as of the v2 structural pass** and has no remaining call site: it
 * was a visible coloured stroke duplicating the pill already on the same row,
 * and §1's separation ladder has no rung for that. The key survives so a
 * `BOOKING_STATUS_UI[s].accent` in a surface not yet converted keeps
 * compiling; do not spend it in new code.
 */
export const BOOKING_STATUS_UI: Record<
  BookingStatus,
  { badge: string; accent: string; block: string; tone: string }
> = {
  pending: {
    badge: "bg-pill-warning text-pill-warning-ink",
    accent: "border-l-warning",
    block: "bg-pill-warning text-pill-warning-ink",
    tone: "bg-pill-warning text-pill-warning-ink",
  },
  confirmed: {
    badge: "bg-pill-info text-pill-info-ink",
    accent: "border-l-info",
    block: "bg-pill-info text-pill-info-ink",
    tone: "bg-pill-info text-pill-info-ink",
  },
  seated: {
    badge: "bg-pill-violet text-pill-violet-ink",
    accent: "border-l-pill-violet-ink",
    block: "bg-pill-violet text-pill-violet-ink",
    tone: "bg-pill-violet text-pill-violet-ink",
  },
  completed: {
    badge: "",
    accent: "border-l-border",
    block: "bg-pill-neutral text-pill-neutral-ink",
    tone: "bg-pill-neutral text-pill-neutral-ink",
  },
  cancelled: {
    badge: "",
    accent: "border-l-border",
    block: "bg-pill-neutral text-pill-neutral-ink line-through",
    tone: "bg-pill-neutral text-pill-neutral-ink",
  },
  no_show: {
    badge: "bg-pill-danger text-pill-danger-ink",
    accent: "border-l-destructive",
    block: "bg-pill-danger text-pill-danger-ink line-through",
    tone: "bg-pill-danger text-pill-danger-ink",
  },
};
