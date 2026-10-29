"use client";

import { ProjectsView } from "@/components/gr8r/projects-view";

/**
 * The Projects index, mounted by `<ProjectsSurface>` when no project id is in
 * the URL. Rendered by the gr8r port (`components/gr8r/projects-view.tsx`):
 * gr8r's Grid / List / Table plus our Board + Timeline layouts, filters,
 * grouping, summary panel and per-row "…" menu.
 */
export function ProjectsIndex({ propertyId }: { propertyId: string }) {
  return <ProjectsView propertyId={propertyId} />;
}
