import { InboxSkeleton } from "@/components/chat/inbox/inbox-skeleton";

/**
 * Suspense fallback for the Inbox route, shaped like <InboxView>. The page's
 * RSC does no blocking fetch — the mentions search streams in — so this
 * renders for ~0 frames on a warm navigation.
 */
export default function InboxLoading() {
  return <InboxSkeleton />;
}
