import { ChannelSkeleton } from "@/components/chat/channel-skeleton";

/**
 * Suspense fallback for the channel route. Its real job is prefetching:
 * Next.js only prefetches a *dynamic* route down to its nearest `loading`
 * boundary (see node_modules/next/dist/docs/.../prefetching.md). Without this
 * file, clicking a channel triggers a full server roundtrip; with it, the
 * route is prefetched while the link sits in the sidebar viewport, so the
 * switch is a client-side transition. On a warm switch the prefetched payload
 * resolves instantly and this fallback renders for ~0 frames.
 */
export default function ChannelLoading() {
  return <ChannelSkeleton />;
}
