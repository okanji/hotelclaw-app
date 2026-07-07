"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { SpaceDetail } from "./space-detail";

/** Any URL under the spaces section — gates the surface OFF other sections. */
const IN_SPACES = /^\/p\/[^/]+\/spaces(?:\/|$)/;
/** Captures the space id from `/p/<pid>/spaces/<id>`. */
const SPACE_ROUTE = /^\/p\/[^/]+\/spaces\/([^/]+)\/?$/;

/**
 * Persistent spaces surface — mounted property-wide in the layout, mirroring
 * `<DocumentsSurface>` / `<ChatSurface>`. It reads the active space from the
 * URL and gates itself OFF every other section, so navigating away from a
 * space (e.g. opening a document) tears the space view down instead of
 * leaving it stacked under the new section — which is the bug that came from
 * rendering `<SpaceDetail>` through the route segment (`{children}`), which
 * does not react to `pushState` hops.
 *
 * Reads the URL via `useSurfacePathname` (stays in lockstep with the other
 * surfaces across `pushState` hops). `<SpaceDetail key={spaceId}>` forces a
 * clean per-space remount on space↔space navigation.
 */
export function SpacesSurface({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();

  if (!IN_SPACES.test(pathname)) return null;
  const spaceId = pathname.match(SPACE_ROUTE)?.[1];
  if (!spaceId) return null;
  return <SpaceDetail key={spaceId} propertyId={propertyId} spaceId={spaceId} />;
}
