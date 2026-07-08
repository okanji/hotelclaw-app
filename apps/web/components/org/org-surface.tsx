"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { OrgView } from "./org-view";

/** Any URL under the org surface. Org chart lives as a sub-view of Home
 *  (`/home/org`), like Insights — gated OFF every other surface. */
const IN_ORG = /^\/p\/[^/]+\/home\/org(?:\/|$)/;

export function OrgSurface({
  propertyId,
  propertyName,
  isManagement,
}: {
  propertyId: string;
  propertyName: string;
  isManagement: boolean;
}) {
  const pathname = useSurfacePathname();
  if (!IN_ORG.test(pathname)) return null;
  return (
    <OrgView
      propertyId={propertyId}
      propertyName={propertyName}
      isManagement={isManagement}
    />
  );
}
