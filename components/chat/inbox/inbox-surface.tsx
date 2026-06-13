"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { InboxView } from "./inbox";

const INBOX_ROUTE = /^\/p\/[^/]+\/inbox\/?$/;

/**
 * Persistent inbox surface — mounted in the property layout so clicking
 * Inbox in the chat sidebar is a `pushState`, not a route navigation. The
 * `inbox/layout.tsx` server-prefetches the mentions query into the cache,
 * so a hard load lands here populated; a `pushState` arrival reads the
 * cache the rail also warms client-side on property entry.
 */
export function InboxSurface({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const pathname = useSurfacePathname();
  if (!INBOX_ROUTE.test(pathname)) return null;
  return <InboxView propertyId={propertyId} userId={userId} />;
}
