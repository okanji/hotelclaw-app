"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { HomeView } from "./home-view";

/** The Home dashboard route exactly — NOT its sub-views. Insights lives at
 *  `/home/insights`, which has its own surface; an inclusive `/home/...` match
 *  here would paint the dashboard on top of it. */
const IN_HOME = /^\/p\/[^/]+\/home\/?$/;

/**
 * Persistent property Home surface — mounted in the property layout alongside
 * the other section surfaces, so the URL gate below is what keeps it from
 * painting on top of chat/tasks/etc. The gate reads `useSurfacePathname`, which
 * stays in lockstep with the other surfaces across `pushState` hops. Home has
 * no detail route, so there's nothing to extract from the path — present or
 * absent.
 */
export function HomeSurface({
  propertyId,
  propertyName,
  userId,
  userName,
}: {
  propertyId: string;
  propertyName: string;
  userId: string;
  userName: string | null;
}) {
  const pathname = useSurfacePathname();

  if (!IN_HOME.test(pathname)) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HomeView
        propertyId={propertyId}
        propertyName={propertyName}
        userId={userId}
        userName={userName}
      />
    </div>
  );
}
