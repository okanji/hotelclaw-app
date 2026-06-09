"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Pathnames that mount the persistent `<ProjectsSurface>`. Inside them, project
 * navigation is a client-side `pushState`; arriving from another section is a
 * real `router.push`. The project page renders `null`, so the surface fully
 * owns rendering and pushState works for project ↔ project transitions.
 */
const IN_PROJECTS_SURFACE = /^\/p\/[^/]+\/projects(?:\/|$)/;

/**
 * Opens a project. When already inside the projects surface this is a pure
 * `pushState` (no RSC round-trip) — the surface re-renders and
 * `<ProjectDetail key={projectId}>` remounts for the new project. From outside
 * the section it falls back to `router.push`. Mirrors `useOpenDocument`.
 */
export function useOpenProject(propertyId: string) {
  const router = useRouter();
  return useCallback(
    (projectId: string) => {
      const href = `/p/${propertyId}/projects/${projectId}`;
      if (IN_PROJECTS_SURFACE.test(window.location.pathname)) {
        window.history.pushState(null, "", href);
        window.dispatchEvent(new Event("hotelclaw:pathname"));
      } else {
        router.push(href);
      }
    },
    [propertyId, router],
  );
}
