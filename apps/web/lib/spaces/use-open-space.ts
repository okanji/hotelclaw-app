"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Pathnames that mount the persistent `<SpacesSurface>`. Inside them, space
 * navigation is a client-side `pushState`; arriving from another section is a
 * real `router.push`. The space page renders `null`, so the surface fully owns
 * rendering and pushState works for space ↔ space transitions.
 */
const IN_SPACES_SURFACE = /^\/p\/[^/]+\/spaces(?:\/|$)/;

/**
 * Opens a space. When already inside the spaces surface this is a pure
 * `pushState` (no RSC round-trip, no `loading.tsx` flash) — the surface
 * re-renders and `<SpaceDetail key={spaceId}>` remounts for the new space.
 * From outside the section it falls back to `router.push`. Mirrors
 * `useOpenDocument` / `useOpenChannel`.
 */
export function useOpenSpace(propertyId: string) {
  const router = useRouter();
  return useCallback(
    (spaceId: string) => {
      const href = `/p/${propertyId}/spaces/${spaceId}`;
      if (IN_SPACES_SURFACE.test(window.location.pathname)) {
        window.history.pushState(null, "", href);
        // `usePathname` updates on Next-instrumented pushState, but the surface
        // also listens for this so its local mirror syncs immediately.
        window.dispatchEvent(new Event("hotelclaw:pathname"));
      } else {
        router.push(href);
      }
    },
    [propertyId, router],
  );
}
