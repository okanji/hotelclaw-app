"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
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
}: {
  propertyId: string;
  userId: string;
}) {
  const pathname = useSurfacePathname();
  if (!ACTIVITY_ROUTE.test(pathname)) return null;
  return <ActivityView propertyId={propertyId} userId={userId} />;
}
