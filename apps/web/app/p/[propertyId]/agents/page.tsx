import { createClient } from "@/lib/supabase/server";
import { AgentsList } from "@/components/agents/agents-list";
import type { AgentRow } from "@/lib/agents/schema";

/**
 * Agents index — every internal AI agent in the property (RLS scopes the
 * tenant), plus the read-only Built-in AI transparency gallery.
 */
export default async function AgentsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, config, status, created_by, archived_at, created_at, updated_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  // Fleet pod bots (empty for non-pod properties) — the gallery shows
  // EVERY AI in the product, operated ones included.
  const { data: property } = await supabase
    .from("properties")
    .select("client_id")
    .eq("id", propertyId)
    .maybeSingle();
  const { data: podBots } = property?.client_id
    ? await supabase
        .from("bots")
        .select("id, bot_id, display_name, tool_set, model_tier")
        .eq("client_id", property.client_id)
        .order("bot_id")
    : { data: [] };

  return (
    <AgentsList
      propertyId={propertyId}
      agents={(agents ?? []) as unknown as AgentRow[]}
      podBots={podBots ?? []}
    />
  );
}
