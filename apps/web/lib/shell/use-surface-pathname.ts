"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Pathname source for the persistent section surfaces mounted in the property
 * layout (home, chat, tasks, calendar, docs, insights, …). Each surface gates
 * its render on this — present its section's URL prefix, render; otherwise
 * return `null` so the matching section fills the pane.
 *
 * Why not bare `usePathname()`: rail hops and in-section detail opens navigate
 * with `window.history.pushState`. Next 16 patches `pushState` to sync the
 * router, but that update lands in a deferred `startTransition`, while the rail
 * (and the `useOpen*` helpers) ALSO dispatch a synchronous `hotelclaw:pathname`
 * event. A surface reading bare `usePathname` updates a tick later than one
 * listening to the event, so the outgoing surface stays painted on top of the
 * incoming one until the transition commits — the "split screen" bug. Mirroring
 * `window.location` synchronously off the event keeps every surface in lockstep
 * within a single render, so exactly one renders at all times.
 */
export function useSurfacePathname(): string {
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
  return pathname;
}
