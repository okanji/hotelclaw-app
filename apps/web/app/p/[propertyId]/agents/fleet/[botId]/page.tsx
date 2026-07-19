import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadFleetScope } from "@/lib/fleet/server";
import { BotDetail } from "@/components/fleet/bot-detail";

/**
 * Pod-bot workspace: transparent config (tool allow-list, model tier,
 * fallback persona, brain binding) beside a live test chat driving the
 * REAL pod bot through eve.
 */
export default async function FleetBotPage({
  params,
}: {
  params: Promise<{ propertyId: string; botId: string }>;
}) {
  const { propertyId, botId } = await params;
  const scope = await loadFleetScope(propertyId);
  if (!scope.client) notFound();

  const supabase = await createClient();
  const { data: bot } = await supabase
    .from("bots")
    .select("id, client_id, bot_id, display_name, persona_fallback, tool_set, model_tier")
    .eq("id", botId)
    .eq("client_id", scope.client.id)
    .maybeSingle();
  if (!bot) notFound();

  return (
    <BotDetail
      propertyId={propertyId}
      propertySlug={scope.propertySlug ?? ""}
      client={scope.client}
      bot={bot}
      canEdit={scope.role === "owner"}
    />
  );
}
