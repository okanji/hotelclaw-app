/**
 * Human task keys (migration 0108): `<properties.task_prefix>-<number>`,
 * e.g. "GHV-142". Pure + client-safe — the server stamps `key` onto every
 * `getTasks` row; surfaces that only have an id fall back to the
 * UUID-derived glyph.
 */

/** `<prefix>-<number>`, or null when either half is missing. */
export function formatTaskKey(
  prefix: string | null | undefined,
  number: number | null | undefined,
): string | null {
  if (!prefix || number == null || !Number.isFinite(number)) return null;
  return `${prefix}-${number}`;
}

/**
 * Stable visual fallback derived from a task's UUID (`T-AB12`) for rows
 * that predate 0108 or come from a query that doesn't carry the key. Not
 * sequential — just a consistent, scannable 4-char glyph per task.
 */
export function taskShortId(id: string): string {
  const compact = id.replace(/-/g, "").toUpperCase().slice(0, 4);
  return `T-${compact || "0000"}`;
}

/** The key to show for a task: its real key when known, else the glyph. */
export function taskKey(task: { id: string; key?: string | null }): string {
  return task.key || taskShortId(task.id);
}
