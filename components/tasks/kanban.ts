import type { TaskPriority, TaskStatus } from "@/lib/db/types";

/** A task as returned by `GET /api/properties/[id]/tasks`. */
export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_at: string | null;
  /** ISO timestamps for the timeline/Gantt view (migration 0017). */
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  position: number;
  updated_at: string;
  created_at?: string;
};

/** The board's columns, left to right, with their accent dot colour. */
export const COLUMNS: {
  id: TaskStatus;
  label: string;
  dotClass: string;
  /** Soft WIP limit — column count badge turns amber over this. `null` = no limit. */
  wipLimit: number | null;
}[] = [
  { id: "todo", label: "To do", dotClass: "bg-zinc-400", wipLimit: null },
  { id: "in_progress", label: "In progress", dotClass: "bg-blue-500", wipLimit: 5 },
  { id: "blocked", label: "Blocked", dotClass: "bg-amber-500", wipLimit: 3 },
  { id: "done", label: "Done", dotClass: "bg-emerald-500", wipLimit: null },
];

export const STATUS_IDS: TaskStatus[] = COLUMNS.map((c) => c.id);

export const PRIORITY_META: Record<
  TaskPriority,
  {
    label: string;
    /**
     * Number of filled bars in the priority indicator — 1 (low) through 3
     * (high/urgent), or 0 when no priority is set. Used by `<PriorityBars />`
     * to render an audio-meter style level glyph; `urgent` is special-cased
     * to render an exclamation icon instead.
     */
    rank: 0 | 1 | 2 | 3;
    dotClass: string;
    textClass: string;
    /** Tailwind class for the filled bars in `<PriorityBars />`. */
    barColorClass: string;
    /** Tinted pill background + text used by the on-card priority badge. */
    badgeClass: string;
    /** Tailwind class for the left accent stripe on cards (legacy — kept for skeleton/overlay tinting). */
    stripeClass: string;
    /**
     * Sort weight — lower = sorts first ascending. We keep urgent first and
     * "no priority" last so the board surfaces high-signal cards at the top
     * when sorted by priority.
     */
    order: number;
    /** Keyboard shortcut number shown in the priority menu (Linear-style: 0–4). */
    shortcut: 0 | 1 | 2 | 3 | 4;
  }
> = {
  urgent: {
    label: "Urgent",
    rank: 3,
    dotClass: "bg-red-500",
    textClass: "text-red-600 dark:text-red-400",
    barColorClass: "bg-red-500",
    badgeClass:
      "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400 dark:ring-red-500/30",
    stripeClass: "before:bg-red-500",
    order: 0,
    shortcut: 1,
  },
  high: {
    label: "High",
    rank: 3,
    dotClass: "bg-amber-500",
    textClass: "text-foreground",
    barColorClass: "bg-foreground",
    badgeClass:
      "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30",
    stripeClass: "before:bg-amber-500",
    order: 1,
    shortcut: 2,
  },
  medium: {
    label: "Medium",
    rank: 2,
    dotClass: "bg-blue-500",
    textClass: "text-foreground",
    barColorClass: "bg-foreground",
    badgeClass:
      "bg-blue-500/10 text-blue-600 ring-blue-500/20 dark:text-blue-400 dark:ring-blue-500/30",
    stripeClass: "before:bg-blue-500/70",
    order: 2,
    shortcut: 3,
  },
  low: {
    label: "Low",
    rank: 1,
    dotClass: "bg-zinc-400",
    textClass: "text-muted-foreground",
    barColorClass: "bg-foreground",
    badgeClass:
      "bg-zinc-500/10 text-zinc-600 ring-zinc-500/15 dark:text-zinc-300 dark:ring-zinc-400/25",
    stripeClass: "before:bg-transparent",
    order: 3,
    shortcut: 4,
  },
  none: {
    label: "No priority",
    rank: 0,
    dotClass: "bg-transparent",
    textClass: "text-muted-foreground",
    barColorClass: "bg-foreground/40",
    badgeClass:
      "bg-transparent text-muted-foreground ring-border/60",
    stripeClass: "before:bg-transparent",
    order: 4,
    shortcut: 0,
  },
};

/**
 * Short, stable visual identifier derived from a task's UUID — used in card
 * meta rows (`T-AB12`) so the board reads more like Linear/Jira. Not a real
 * sequential id; just a consistent, scannable 4-char glyph per task.
 */
export function taskShortId(id: string): string {
  const compact = id.replace(/-/g, "").toUpperCase().slice(0, 4);
  return `T-${compact || "0000"}`;
}

export const PRIORITY_IDS: TaskPriority[] = ["urgent", "high", "medium", "low"];

/**
 * Order of items in the priority menu — matches Linear (No priority first,
 * then most urgent → least urgent). Keep in sync with `PRIORITY_META[*].shortcut`.
 */
export const PRIORITY_MENU_ORDER: TaskPriority[] = [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
];

/** How the board orders cards within columns. `manual` = preserve user-defined position. */
export type SortBy = "manual" | "priority" | "due_at";

export const SORT_LABELS: Record<SortBy, string> = {
  manual: "Manual order",
  priority: "Priority",
  due_at: "Due date",
};

/** Spacing between freshly seeded card positions. */
export const POSITION_GAP = 1024;

/**
 * Returns a `position` strictly between two neighbouring cards, so a card
 * dropped between them keeps the column sorted without renumbering the rest.
 * `null` neighbours mean "top" / "bottom" of the column.
 */
export function computePosition(
  before: number | null,
  after: number | null,
): number {
  if (before == null && after == null) return POSITION_GAP;
  if (before == null) return (after as number) - POSITION_GAP;
  if (after == null) return before + POSITION_GAP;
  return (before + after) / 2;
}

/** True when the id refers to a column rather than a card. */
export function isColumnId(id: string): id is TaskStatus {
  return (STATUS_IDS as string[]).includes(id);
}
