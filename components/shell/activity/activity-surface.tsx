"use client";

import { usePathname } from "next/navigation";
import { ActivityView } from "./activity-view";

/** Matches `/p/<pid>/activity` (with or without trailing slash). */
const ACTIVITY_ROUTE = /^\/p\/[^/]+\/activity\/?$/;

/**
 * Persistent activity surface — mounted in the property layout so a rail
 * click to Activity from any other section is a zero-roundtrip
 * `pushState`, not a cross-segment route navigation. Returns null off the
 * `/activity` URL; the other section surfaces render then.
 */
export function ActivitySurface({
  propertyId,
  userId,
  userName,
}: {
  propertyId: string;
  userId: string;
  userName: string | null;
}) {
  const pathname = usePathname();
  if (!ACTIVITY_ROUTE.test(pathname)) return null;
  return (
    <ActivityView
      propertyId={propertyId}
      userId={userId}
      userName={userName}
    />
  );
}
