/**
 * DMs index landing. The "No conversation selected" empty state is rendered by
 * the persistent `<ChatSurface>` in the property layout — see chat-surface.tsx
 * — so a rail click can `pushState` to this URL without Next having to mount
 * a new route segment. This page exists only so `/p/<pid>/dms` URLs resolve
 * on a hard load / deep link.
 */
export default function DmsIndex() {
  return null;
}
