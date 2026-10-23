import { notFound } from "next/navigation";
import { loadFleetScope } from "@/lib/fleet/server";
import { AccessView } from "@/components/fleet/access-view";

/** API access — the property's Actions API keys (pod properties only). */
export default async function FleetAccessPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const scope = await loadFleetScope(propertyId);
  if (!scope.client) notFound();
  return <AccessView propertyId={propertyId} isOwner={scope.role === "owner"} />;
}
