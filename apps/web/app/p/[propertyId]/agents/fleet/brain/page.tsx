import { notFound } from "next/navigation";
import { loadFleetScope } from "@/lib/fleet/server";
import { BrainView } from "@/components/fleet/brain-view";

/**
 * Brain & access — the pod's knowledge-brain status (health, source
 * binding, isolation model) plus the property's Actions API keys.
 * The health probe runs server-side (BRAIN_MCP_URL never reaches the
 * client); fail-soft: unreachable renders as a status, not an error page.
 */
export default async function FleetBrainPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const scope = await loadFleetScope(propertyId);
  if (!scope.client) notFound();

  let health: { status?: string; version?: string; engine?: string } | null =
    null;
  const brainUrl = process.env.BRAIN_MCP_URL;
  if (brainUrl && scope.client.brain_source) {
    try {
      const response = await fetch(`${new URL(brainUrl).origin}/health`, {
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      if (response.ok) {
        health = (await response.json()) as {
          status?: string;
          version?: string;
          engine?: string;
        };
      }
    } catch {
      health = null;
    }
  }

  return (
    <BrainView
      propertyId={propertyId}
      client={scope.client}
      health={health}
      configured={Boolean(brainUrl && scope.client.brain_source)}
      isOwner={scope.role === "owner"}
    />
  );
}
