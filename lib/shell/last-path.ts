/**
 * Per-property, per-section memory of the last route the user had open,
 * stored in `localStorage`. The rail reads it so each section button jumps
 * back to where the user left off instead of the section's generic landing
 * route — which for Chat also skips the `/chat` index's DB query + server
 * `redirect()` (two roundtrips) entirely.
 *
 * Best-effort: a miss (first visit, cleared / disabled storage) just falls
 * back to the landing route, so every read and write tolerates failure.
 */

const KEY_PREFIX = "hotelclaw:last-path:";

function key(propertyId: string, section: string): string {
  return `${KEY_PREFIX}${propertyId}:${section}`;
}

/** Records `path` as the last route visited in `section` for `propertyId`. */
export function rememberSectionPath(
  propertyId: string,
  section: string,
  path: string,
): void {
  try {
    window.localStorage.setItem(key(propertyId, section), path);
  } catch {
    // Private mode / quota / storage disabled — harmless, see module note.
  }
}

/**
 * The last route visited in `section` for `propertyId`, or `null` if none is
 * remembered. Returns `null` when called outside the browser.
 */
export function lastSectionPath(
  propertyId: string,
  section: string,
): string | null {
  try {
    return window.localStorage.getItem(key(propertyId, section));
  } catch {
    return null;
  }
}
