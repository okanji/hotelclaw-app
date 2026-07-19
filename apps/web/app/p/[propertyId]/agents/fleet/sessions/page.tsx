import { notFound } from "next/navigation";
import { loadFleetScope } from "@/lib/fleet/server";
import { SessionsView } from "@/components/fleet/sessions-view";

/**
 * Fleet sessions — every durable eve session the pod bots hold in this
 * property: channel conversations and workflow runs. Live list (Realtime
 * invalidation in AgentsSection); ?session=<eve id> opens the transcript.
 */
export default async function FleetSessionsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const scope = await loadFleetScope(propertyId);
  if (!scope.client) notFound();

  return <SessionsView propertyId={propertyId} />;
}
