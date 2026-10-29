import { isDone, type StatusLike } from "@/lib/tasks/statuses";

/**
 * My Tasks lenses — pure filters over the shared `["tasks", propertyId]`
 * cache, so the page needs no endpoint of its own. Linear's "My issues"
 * model: Assigned (work you own) and Created (work you filed, whoever owns
 * it); the activity tab reads `activity_log` with an actor scope instead.
 *
 * There is deliberately no "Subscribed" lens: tasks have no subscription /
 * watcher concept in this schema.
 */

export const MY_TASKS_TABS = ["focus", "assigned", "created", "activity"] as const;
export type MyTasksTab = (typeof MY_TASKS_TABS)[number];

export function parseMyTasksTab(value: string | null | undefined): MyTasksTab {
  return (MY_TASKS_TABS as readonly string[]).includes(value ?? "")
    ? (value as MyTasksTab)
    : "focus";
}

type LensTask = StatusLike & {
  id: string;
  assignee_id: string | null;
  created_by?: string | null;
  parent_id?: string | null;
};

/**
 * Rows for a lens: every task the predicate matches, EXCEPT sub-issues whose
 * parent also matches — those render nested under the parent (the list view
 * expands children), so listing them twice would double-count. A sub-issue
 * assigned to you under someone else's parent stays a top-level row, or it
 * would be invisible.
 */
export function lensRows<T extends LensTask>(
  tasks: T[],
  match: (t: T) => boolean,
): T[] {
  const matched = new Set(tasks.filter(match).map((t) => t.id));
  return tasks.filter(
    (t) => matched.has(t.id) && !(t.parent_id && matched.has(t.parent_id)),
  );
}

export function assignedRows<T extends LensTask>(tasks: T[], userId: string): T[] {
  return lensRows(tasks, (t) => t.assignee_id === userId);
}

export function createdRows<T extends LensTask>(tasks: T[], userId: string): T[] {
  return lensRows(tasks, (t) => t.created_by === userId);
}

export function openCount(tasks: LensTask[]): number {
  return tasks.filter((t) => !isDone(t)).length;
}
