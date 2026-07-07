import { ChannelSkeleton } from "@/components/chat/channel-skeleton";

/**
 * Suspense fallback for the DM route — same role as the chat route's
 * `loading.tsx`: its presence lets Next.js prefetch this dynamic route down
 * to the loading boundary, so opening a conversation is a client-side
 * transition rather than a full server roundtrip. On a warm switch the
 * prefetched payload resolves instantly and this renders for ~0 frames.
 */
export default function DmChannelLoading() {
  return <ChannelSkeleton />;
}
