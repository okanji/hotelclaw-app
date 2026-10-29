import { WsTimelinePage } from "@/components/gr8r/ws-timeline-view";

/**
 * `/p/<id>/timeline` — gr8r's workspace timeline (`pageWsTimeline`): a Gantt
 * over every project's dated tasks and milestones. A real route (the
 * sidebar's Timeline row links here); the view gates itself on the surface
 * pathname like Favorites.
 */
export default async function Timeline({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <WsTimelinePage propertyId={propertyId} />;
}
