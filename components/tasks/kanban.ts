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
  position: number;
  updated_at: string;
};

/** The board's columns, left to right, with their accent dot colour. */
export const COLUMNS: {
  id: TaskStatus;
  label: string;
  dotClass: string;
}[] = [
  { id: "todo", label: "To do", dotClass: "bg-muted-foreground/50" },
  { id: "in_progress", label: "In progress", dotClass: "bg-blue-500" },
  { id: "blocked", label: "Blocked", dotClass: "bg-amber-500" },
  { id: "done", label: "Done", dotClass: "bg-emerald-500" },
];

export const STATUS_IDS: TaskStatus[] = COLUMNS.map((c) => c.id);

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; dotClass: string; textClass: string }
> = {
  low: {
    label: "Low",
    dotClass: "bg-zinc-400",
    textClass: "text-muted-foreground",
  },
  medium: {
    label: "Medium",
    dotClass: "bg-blue-500",
    textClass: "text-muted-foreground",
  },
  high: {
    label: "High",
    dotClass: "bg-amber-500",
    textClass: "text-foreground",
  },
  urgent: {
    label: "Urgent",
    dotClass: "bg-red-500",
    textClass: "text-red-600 dark:text-red-400",
  },
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
