"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ProjectDetail } from "./project-detail";
import { ProjectsIndex } from "./projects-index";

/** Any URL under the projects section — gates the surface OFF other sections. */
const IN_PROJECTS = /^\/p\/[^/]+\/projects(?:\/|$)/;
/** Captures the project id from `/p/<pid>/projects/<id>`. */
const PROJECT_ROUTE = /^\/p\/[^/]+\/projects\/([^/]+)\/?$/;

/**
 * Persistent projects surface — mounted property-wide in the layout, mirroring
 * `<DocumentsSurface>`. Reads the active project (or the index) from the URL
 * and gates itself OFF every other section, so navigating away (e.g. opening a
 * document) tears the project view down instead of leaving it stacked.
 *
 * Real navigations update via `usePathname`; in-section `pushState` hops sync
 * through `popstate` / `hotelclaw:pathname`. `<ProjectDetail key={projectId}>`
 * forces a clean per-project remount on project↔project navigation.
 */
export function ProjectsSurface({ propertyId }: { propertyId: string }) {
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

  if (!IN_PROJECTS.test(pathname)) return null;
  const projectId = pathname.match(PROJECT_ROUTE)?.[1];
  if (projectId) {
    return (
      <ProjectDetail
        key={projectId}
        propertyId={propertyId}
        projectId={projectId}
      />
    );
  }
  return <ProjectsIndex propertyId={propertyId} />;
}
