/**
 * Team-channel route landing.
 *
 * The message pane is rendered by the persistent `<ChatSurface>` in the
 * property layout — it reads the active channel from the URL, so in-app
 * channel switching is a client-side `history.pushState` that never navigates
 * this route. This page exists only so `/chat/[channelId]` URLs resolve on a
 * hard load / deep link; `<ChatSurface>` then renders the channel.
 */
export default function ChannelPage() {
  return null;
}
