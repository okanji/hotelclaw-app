import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadFleetScope } from "@/lib/fleet/server";
import { PodBotsList } from "@/components/fleet/pod-bots-list";

/**
 * Fleet index — the pod bots serving this property. Only exists for
 * properties that belong to a client (pod).
 */
export default async function FleetPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const scope = await loadFleetScope(propertyId);
  if (!scope.client) notFound();

  const supabase = await createClient();
  const { data: bots } = await supabase
    .from("bots")
    .select("id, bot_id, display_name, persona_fallback, tool_set, model_tier")
    .eq("client_id", scope.client.id)
    .order("bot_id");

  return (
    <PodBotsList
      propertyId={propertyId}
      client={scope.client}
      bots={bots ?? []}
    />
  );
}
