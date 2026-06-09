"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
 * Real navigations update via `usePathname`; in-section `pushState` hops sync
 * through `popstate` / `hotelclaw:pathname`. `<SpaceDetail key={spaceId}>`
 * forces a clean per-space remount on space↔space navigation.
 */
export function SpacesSurface({ propertyId }: { propertyId: string }) {
  const nextPathname = usePathname();
  const [pathname, setPathname] = useState(nextPathname);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPathname(nextPathname);
  }, [nextPathname]);
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener("hotelclaw:pathname", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hotelclaw:pathname", sync);
    };
  }, []);

  if (!IN_SPACES.test(pathname)) return null;
  const spaceId = pathname.match(SPACE_ROUTE)?.[1];
  if (!spaceId) return null;
  return <SpaceDetail key={spaceId} propertyId={propertyId} spaceId={spaceId} />;
}
