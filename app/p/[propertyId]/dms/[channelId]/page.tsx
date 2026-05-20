/**
 * Direct-message route landing.
 *
 * Like the team-channel route, the conversation is rendered by the persistent
 * `<ChatSurface>` in the property layout — in-app switching is a client-side
 * `history.pushState` that never navigates this route. This page exists only
 * so `/dms/[channelId]` URLs resolve on a hard load / deep link.
 */
export default function DmChannelPage() {
  return null;
}
