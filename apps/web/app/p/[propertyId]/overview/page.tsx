import { OverviewPage } from "@/components/gr8r/overview-view";

/**
 * `/p/<id>/overview` — gr8r's Workspace overview (src/pages/overview.js). A
 * real route (the sidebar's Overview row links here); the view gates itself
 * on the surface pathname so a pushState hop to another section never
 * leaves it painted underneath.
 */
export default async function Overview({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <OverviewPage propertyId={propertyId} />;
}
