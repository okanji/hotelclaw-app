import type { EntityColor } from "@/lib/db/types";

export const LABEL_COLORS: EntityColor[] = [
  "slate",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
];

export const LABEL_DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

/**
 * Entity chips (labels, projects, teams) are the ONE place the app spends a
 * saturated hue — they are user-chosen identity, not chrome. Notion's own tag
 * chips are the same shape: a soft ~15% wash with dark ink, no stroke.
 * `EntityColor` is the sanctioned palette (DESIGN.md § Entity colors); every
 * other coloured thing in this feature surface uses the semantic status ramp.
 */
export const LABEL_CHIP: Record<EntityColor, string> = {
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};
