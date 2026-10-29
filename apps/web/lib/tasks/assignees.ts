/**
 * Multiple assignees (0115) — pure helpers shared by the write path, the
 * readers and both apps' tests. The SET lives in `task_assignees`;
 * `tasks.assignee_id` is the derived PRIMARY (first of the set), so any row
 * without the embedded set still reads correctly through `taskAssigneeIds`.
 */

export const MAX_ASSIGNEES = 20;

/** The people on a task, primary first. Falls back to the legacy column. */
export function taskAssigneeIds(t: {
  assignee_ids?: string[] | null;
  assignee_id?: string | null;
}): string[] {
  if (t.assignee_ids && t.assignee_ids.length > 0) return t.assignee_ids;
  return t.assignee_id ? [t.assignee_id] : [];
}

/** True when `userId` is ANY assignee, not just the primary. */
export function isAssignedTo(
  t: { assignee_ids?: string[] | null; assignee_id?: string | null },
  userId: string,
): boolean {
  return taskAssigneeIds(t).includes(userId);
}

/** De-duplicate (first occurrence wins, so order = position) and cap. */
export function normalizeAssigneeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, MAX_ASSIGNEES);
}

/** Who joined and who left between two sets. Order is ignored. */
export function diffAssignees(
  previous: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const prev = new Set(previous);
  const nxt = new Set(next);
  return {
    added: [...nxt].filter((id) => !prev.has(id)),
    removed: [...prev].filter((id) => !nxt.has(id)),
  };
}

/** Toggle one person in a set, keeping the others' order. */
export function toggleAssignee(ids: readonly string[], userId: string): string[] {
  return ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId];
}

/** Move one person to the front (primary). No-op when absent. */
export function makePrimary(ids: readonly string[], userId: string): string[] {
  if (!ids.includes(userId)) return [...ids];
  return [userId, ...ids.filter((id) => id !== userId)];
}

/** Embedded `task_assignees(user_id, position)` rows → ordered ids. */
export function assigneeIdsFromEmbed(
  rows: { user_id: string; position: number; created_at?: string }[] | null | undefined,
): string[] {
  return [...(rows ?? [])]
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
        a.user_id.localeCompare(b.user_id),
    )
    .map((r) => r.user_id);
}
