import { notFound } from "next/navigation";
import { loadFleetScope } from "@/lib/fleet/server";
import { ApprovalsView } from "@/components/fleet/approvals-view";

/**
 * Approvals inbox — sessions parked on a gated (money-moving) tool call,
 * waiting for a human decision. Approve/Deny resolves the park exactly
 * like chatting "approve" at the bot.
 */
export default async function FleetApprovalsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const scope = await loadFleetScope(propertyId);
  if (!scope.client) notFound();

  return (
    <ApprovalsView
      propertyId={propertyId}
      canDecide={scope.role === "owner" || scope.role === "manager"}
    />
  );
}
