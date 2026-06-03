"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { HomeView } from "./home-view";

/** Any URL under the home section — gates the surface OFF other sections. */
const IN_HOME = /^\/p\/[^/]+\/home(?:\/|$)/;

/**
 * Persistent property Home surface — mounted in the property layout alongside
 * the other section surfaces, so the URL gate below is what keeps it from
 * painting on top of chat/tasks/etc. Mirrors `<DocumentsSurface>`: real Next
 * navigations update via `usePathname`, in-section `pushState` hops sync
 * through `popstate` / the `hotelclaw:pathname` event. Home has no detail
 * route, so there's nothing to extract from the path — present or absent.
 */
export function HomeSurface({
  propertyId,
  propertyName,
}: {
  propertyId: string;
  propertyName: string;
}) {
  const nextPathname = usePathname();
  const [pathname, setPathname] = useState(nextPathname);
  useEffect(() => {
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

  if (!IN_HOME.test(pathname)) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HomeView propertyId={propertyId} propertyName={propertyName} />
    </div>
  );
}
