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

/**
 * URL prefix that identifies each section's routes. Single source of truth —
 * both the writer (`LastPathRecorder`'s "should I store this pathname?" gate)
 * and the reader (`lastSectionPath`'s freshness check) use this. Adding or
 * renaming a section's route means updating this map and nowhere else.
 *
 * Re-checking the prefix at read time is what stops a route-shape change from
 * mis-routing: a user who used DMs before the `/dms/[channelId]` split has
 * `/chat/<dmId>` entries under the "dms" key (the recorder back then wrote
 * any `/chat/...` while section="dms"). Without validation, reading those
 * stale entries lands the rail on a channel under the DMs sidebar.
 */
const SECTION_PREFIX: Record<string, string> = {
  home: "/home",
  // More specific than `home` — must be checked as its own section (the rail
  // reads it to jump back to the last Insights tab, e.g. Reports).
  insights: "/home/insights",
  activity: "/activity",
  chat: "/chat/",
  dms: "/dms/",
  tasks: "/tasks",
  calendar: "/calendar",
  docs: "/documents",
};

function key(propertyId: string, section: string): string {
  return `${KEY_PREFIX}${propertyId}:${section}`;
}

/** The URL prefix a section's recorded paths must contain to be valid. */
export function sectionPathPrefix(section: string): string | undefined {
  return SECTION_PREFIX[section];
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
 * remembered or the stored value no longer matches the section's URL shape
 * (see `SECTION_PREFIX` for why we re-check at read time). Returns `null`
 * outside the browser.
 */
export function lastSectionPath(
  propertyId: string,
  section: string,
): string | null {
  try {
    const stored = window.localStorage.getItem(key(propertyId, section));
    if (!stored) return null;
    const prefix = SECTION_PREFIX[section];
    // No prefix configured ⇒ accept anything (forward-compat for new
    // sections). Otherwise drop entries that don't match — the recorder will
    // overwrite with a fresh, valid path on the next in-section navigation.
    if (prefix && !stored.includes(prefix)) return null;
    return stored;
  } catch {
    return null;
  }
}
