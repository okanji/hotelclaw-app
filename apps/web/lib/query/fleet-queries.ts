import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

// React Query option factories for the Fleet surfaces (pod bots). All reads
// go through the user's RLS client — members of a pod property can SELECT
// the tenancy spine (is_client_member policies, migration 0074). The
// approvals count feeds the rail badge + Agents sidebar; AgentsSection
// invalidates these via a Realtime subscription on bot_chat_sessions.

export type PodRow = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "paused" | "offboarded";
  brain_source: string;
};

/** The property's pod (client row) — null hides all Fleet UI. */
export function podQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["fleet-pod", propertyId] as const,
    queryFn: async (): Promise<PodRow | null> => {
      const supabase = createClient();
      const { data: property } = await supabase
        .from("properties")
        .select("client_id")
        .eq("id", propertyId)
        .maybeSingle();
      if (!property?.client_id) return null;
      const { data: client } = await supabase
        .from("clients")
        .select("id, slug, name, status, brain_source")
        .eq("id", property.client_id)
        .maybeSingle();
      return (client as PodRow | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

export type PodBotRow = {
  id: string;
  bot_id: string;
  display_name: string;
  persona_fallback: string | null;
  tool_set: string[];
  model_tier: "standard" | "advanced";
};

export function podBotsQueryOptions(propertyId: string, clientId: string | null) {
  return queryOptions({
    queryKey: ["fleet-bots", propertyId, clientId] as const,
    enabled: Boolean(clientId),
    queryFn: async (): Promise<PodBotRow[]> => {
      if (!clientId) return [];
      const supabase = createClient();
      const { data } = await supabase
        .from("bots")
        .select("id, bot_id, display_name, persona_fallback, tool_set, model_tier")
        .eq("client_id", clientId)
        .order("bot_id");
      return (data ?? []) as PodBotRow[];
    },
    staleTime: 60_000,
  });
}

export type FleetSessionRow = {
  id: string;
  channel_id: string;
  eve_session_id: string | null;
  last_turn_at: string | null;
  status: "idle" | "awaiting_approval";
  pending_approval: {
    requests?: Array<{ toolName?: string; input?: unknown; callId?: string | null }>;
    requestedAt?: string;
    channelId?: string;
  } | null;
  bot: { bot_id: string; display_name: string } | null;
};

export function fleetSessionsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["fleet-sessions", propertyId] as const,
    queryFn: async (): Promise<FleetSessionRow[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("bot_chat_sessions")
        .select(
          `id, channel_id, eve_session_id, last_turn_at, status, pending_approval,
           bot:bots(bot_id, display_name)`,
        )
        .eq("property_id", propertyId)
        .order("last_turn_at", { ascending: false, nullsFirst: false })
        .limit(50);
      return (data ?? []) as unknown as FleetSessionRow[];
    },
    staleTime: 30_000,
  });
}

/** Sessions parked on a gated action — the approvals inbox + badges. */
export function pendingApprovalsCountQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["fleet-approvals-count", propertyId] as const,
    queryFn: async (): Promise<number> => {
      const supabase = createClient();
      const { count } = await supabase
        .from("bot_chat_sessions")
        .select("id", { count: "exact", head: true })
        .eq("property_id", propertyId)
        .eq("status", "awaiting_approval");
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}
