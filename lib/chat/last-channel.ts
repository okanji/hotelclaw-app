/**
 * Per-property memory of the channel/DM the user last had open, kept in
 * `localStorage`. The rail's Chat / DMs buttons read it to jump straight to
 * `/p/<id>/chat/<channelId>` instead of bouncing through the `/chat` index —
 * which runs a DB query and a server `redirect()` to pick the first channel,
 * i.e. two server roundtrips on every click.
 *
 * A miss (first visit, cleared storage, disabled storage) just means the rail
 * falls back to the `/chat` index, so every read/write is best-effort.
 */

const KEY_PREFIX = "hotelclaw:last-channel:";

/** Records the channel the user is currently viewing for `propertyId`. */
export function rememberLastChannel(
  propertyId: string,
  channelId: string,
): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + propertyId, channelId);
  } catch {
    // Private mode / quota / storage disabled — harmless, see module note.
  }
}

/**
 * The route to the last channel opened in `propertyId`, or `null` if none is
 * remembered. Returns `null` when called outside the browser.
 */
export function lastChannelPath(propertyId: string): string | null {
  try {
    const id = window.localStorage.getItem(KEY_PREFIX + propertyId);
    return id ? `/p/${propertyId}/chat/${id}` : null;
  } catch {
    return null;
  }
}
