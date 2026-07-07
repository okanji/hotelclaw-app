import { ChannelSkeleton } from "@/components/chat/channel-skeleton";

/**
 * Suspense fallback for the `/chat` index. The index runs a DB query then
 * server-`redirect()`s to the first channel — without this boundary that
 * round-trip blocks navigation with the previous page frozen on screen, and
 * Next can't prefetch the route (it only prefetches down to the nearest
 * `loading` boundary). Reuses `ChannelSkeleton` so a cold Chat-rail click
 * flows seamlessly into `chat/[channelId]`'s identical fallback.
 */
export default function ChatIndexLoading() {
  return <ChannelSkeleton />;
}
