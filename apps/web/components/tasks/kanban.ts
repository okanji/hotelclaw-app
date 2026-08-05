import type { RecordSource, TaskPriority, TaskStatus } from "@/lib/db/types";

/** A task as returned by `GET /api/properties/[id]/tasks`. */
export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  /** Returned by the tasks API; used by My Tasks' "waiting on others" lens. */
  created_by?: string | null;
  due_at: string | null;
  parent_id?: string | null;
  labels?: string[];
  project_name?: string | null;
  space_id?: string | null;
  project_id?: string | null;
  /** ISO timestamps for the timeline/Gantt view (migration 0017). */
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  position: number;
  updated_at: string;
  created_at?: string;
  /** Creation provenance (migration 0050) — 'workflow' rows get a ⚡ badge. */
  source?: RecordSource | null;
  source_workflow_id?: string | null;
  source_workflow_run_id?: string | null;
};

/**
 * The board's columns, left to right.
 *
 * `pillTone` is the column's HUE, and it is the only colour the column header
 * carries — Notion's board groups have **no column background at all**; the
 * group header is a status pill (`rounded-pill bg-pill-<tone>
 * text-pill-<tone>-ink`, notion-spec-v2 §6) and the inline "+ New" row at the
 * foot of the column is tinted to the same hue. `dotClass` survives for the
 * legacy surfaces (timeline/workload legends) that still draw a dot.
 */
export const COLUMNS: {
  id: TaskStatus;
  label: string;
  dotClass: string;
  /** Pill token family for the group header + inline add row. */
  pillTone: "neutral" | "info" | "warning" | "success";
  /** Soft WIP limit — column count badge turns amber over this. `null` = no limit. */
  wipLimit: number | null;
}[] = [
  {
    id: "todo",
    label: "To do",
    dotClass: "bg-muted-foreground",
    pillTone: "neutral",
    wipLimit: null,
  },
  {
    id: "in_progress",
    label: "In progress",
    dotClass: "bg-info",
    pillTone: "info",
    wipLimit: 5,
  },
  {
    id: "blocked",
    label: "Blocked",
    dotClass: "bg-warning",
    pillTone: "warning",
    wipLimit: 3,
  },
  {
    id: "done",
    label: "Done",
    dotClass: "bg-success",
    pillTone: "success",
    wipLimit: null,
  },
];

/**
 * Column hue → the two class pairs a board group spends it on. Kept here (not
 * inline in the column component) so a new status lands its pill and its
 * inline-add tint in one place. Static strings — Tailwind must see them.
 */
export const COLUMN_PILL_CLASS: Record<
  (typeof COLUMNS)[number]["pillTone"],
  { pill: string; add: string }
> = {
  neutral: { pill: "bg-pill-neutral text-pill-neutral-ink", add: "text-muted-foreground hover:bg-pill-neutral" },
  info: { pill: "bg-pill-info text-pill-info-ink", add: "text-muted-foreground hover:bg-pill-info" },
  warning: { pill: "bg-pill-warning text-pill-warning-ink", add: "text-muted-foreground hover:bg-pill-warning" },
  success: { pill: "bg-pill-success text-pill-success-ink", add: "text-muted-foreground hover:bg-pill-success" },
};

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
    /**
     * The measured Notion **select pill** (notion-spec-v2 §6) used by the
     * on-card priority badge: fill = the hue at ~16%, ink = the same hue
     * darkened. Sourced from the `--pill-*` token pairs, never hand-mixed
     * alpha — a `bg-<hue>/10 text-<hue>` pill drifts from every other status
     * chip in the app and fails contrast on the darker hues.
     */
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
    dotClass: "bg-destructive",
    textClass: "text-destructive",
    barColorClass: "bg-destructive",
    badgeClass: "bg-pill-danger text-pill-danger-ink",
    stripeClass: "before:bg-destructive",
    order: 0,
    shortcut: 1,
  },
  high: {
    label: "High",
    rank: 3,
    dotClass: "bg-warning",
    textClass: "text-foreground",
    barColorClass: "bg-foreground",
    badgeClass: "bg-pill-warning text-pill-warning-ink",
    stripeClass: "before:bg-warning",
    order: 1,
    shortcut: 2,
  },
  medium: {
    label: "Medium",
    rank: 2,
    dotClass: "bg-info",
    textClass: "text-foreground",
    barColorClass: "bg-foreground",
    badgeClass: "bg-pill-info text-pill-info-ink",
    stripeClass: "before:bg-info/70",
    order: 2,
    shortcut: 3,
  },
  low: {
    label: "Low",
    rank: 1,
    dotClass: "bg-muted-foreground",
    textClass: "text-muted-foreground",
    barColorClass: "bg-foreground",
    badgeClass: "bg-pill-neutral text-pill-neutral-ink",
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
    badgeClass: "bg-pill-neutral text-pill-neutral-ink",
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
