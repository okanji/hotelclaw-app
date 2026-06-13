"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
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
 * Reads the URL via `useSurfacePathname` (stays in lockstep with the other
 * surfaces across `pushState` hops). `<ProjectDetail key={projectId}>` forces a
 * clean per-project remount on project↔project navigation.
 */
export function ProjectsSurface({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();

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
