/**
 * Previous / next resolution for the task page header (Linear's ↑ / ↓, `k` /
 * `j`). Pure so it's testable: the caller hands it the shared `["tasks"]`
 * list cache and the board's column order.
 *
 * Preferred sequence: the VISIBLE order the user last saw — the board / list
 * publishes its on-screen task ids (filters + sort applied, columns in order)
 * to `lib/tasks/visible-task-order.ts`, and when the current task is in that
 * list we walk it (skipping ids that no longer exist in the cache).
 *
 * Fallback: BOARD ORDER — top-level tasks, column by column, manual
 * `position` within a column (what the board shows with no toolbar sort).
 * A sub-issue walks its siblings instead (same parent, by position), since
 * sub-issues never appear on the board.
 */

type SequenceTask = {
  id: string;
  status: string;
  position: number;
  parent_id?: string | null;
};

export type TaskSequence = {
  prevId: string | null;
  nextId: string | null;
  /** 0-based index of the current task, -1 when it isn't in the list. */
  index: number;
  total: number;
};

const EMPTY: TaskSequence = { prevId: null, nextId: null, index: -1, total: 0 };

export function resolveTaskSequence(
  tasks: readonly SequenceTask[] | undefined,
  currentId: string,
  statusOrder: readonly string[],
  visibleOrder?: readonly string[] | null,
): TaskSequence {
  if (!tasks?.length) return EMPTY;
  const current = tasks.find((t) => t.id === currentId);
  if (!current) return EMPTY;

  if (visibleOrder && visibleOrder.includes(currentId)) {
    // Drop ids the cache no longer has (deleted / archived since publish) so
    // prev/next never points at a dead task; dedupe defensively.
    const known = new Set(tasks.map((t) => t.id));
    const seen = new Set<string>();
    const list = visibleOrder.filter((id) => {
      if (!known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return walk(list, currentId);
  }

  const parentId = current.parent_id ?? null;
  const rank = (status: string) => {
    const i = statusOrder.indexOf(status);
    return i === -1 ? statusOrder.length : i;
  };
  const list = tasks
    .filter((t) => (t.parent_id ?? null) === parentId)
    .sort(
      (a, b) =>
        // Board tasks go column by column; sub-issues are one flat list.
        (parentId ? 0 : rank(a.status) - rank(b.status)) ||
        a.position - b.position ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  return walk(
    list.map((t) => t.id),
    currentId,
  );
}

function walk(list: readonly string[], currentId: string): TaskSequence {
  const index = list.indexOf(currentId);
  return {
    prevId: index > 0 ? list[index - 1]! : null,
    nextId: index >= 0 && index < list.length - 1 ? list[index + 1]! : null,
    index,
    total: list.length,
  };
}
