"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { InsightsView, type InsightsSubView } from "./insights-view";

/** Any URL under the insights surface — gates it OFF other surfaces. Insights
 *  now lives as a sub-view of Home (`/home/insights`), not its own rail. */
const IN_INSIGHTS = /^\/p\/[^/]+\/home\/insights(?:\/|$)/;
/** The reports sub-page — everything else renders the consolidated page. */
const REPORTS_ROUTE = /^\/p\/[^/]+\/home\/insights\/reports\/?$/;

/**
 * Persistent Insights surface — mounted property-wide in the layout, mirroring
 * `<ProjectsSurface>`. Reads the active sub-view from the URL (via
 * `useSurfacePathname`) and gates itself OFF every other section.
 */
export function InsightsSurface({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const pathname = useSurfacePathname();

  if (!IN_INSIGHTS.test(pathname)) return null;
  const view: InsightsSubView = REPORTS_ROUTE.test(pathname)
    ? "reports"
    : "main";

  return <InsightsView propertyId={propertyId} userId={userId} view={view} />;
}
