"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";

/**
 * Renders its children only while the SURFACE pathname is under
 * `/p/<id>/<segment>`. A normal route page under `app/p/[propertyId]` stays
 * mounted when the persistent surfaces (chat, tasks…) navigate by
 * `pushState` — the Next route never changes — so without this gate the page
 * keeps painting above the surface that now owns the URL (a "split screen").
 * Server pages wrap their view in it: `<RouteGate segment="notifications">`.
 */
export function RouteGate({
  segment,
  children,
}: {
  segment: string;
  children: React.ReactNode;
}) {
  const pathname = useSurfacePathname();
  const own = new RegExp(`^/p/[^/]+/${segment}(?:/|$)`).test(pathname);
  return own ? <>{children}</> : null;
}
