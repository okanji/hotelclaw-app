import type { SessionContext } from "eve/context";
// Shared versioned config schema — single source of truth with the builder
// UI (packages/agent-config; dependency-free apart from zod). Cross-package
// RELATIVE imports don't work here: eve snapshots only the agent root, so
// shared code must arrive via a workspace package through node_modules.
import {
  parseAgentConfig,
  type AgentConfig,
} from "@hotelclaw/agent-config";
import { serviceClient } from "./supabase";
import { tenantCallerOrNull, type TenantCaller } from "./tenant";

export type ResolvedAgent = {
  caller: TenantCaller;
  agentId: string;
  name: string;
  config: AgentConfig;
};

// The selected agent for this session, verified against the caller's
// property. agentId is stamped by channel auth; a session without one (bare
// smoke tests) resolves to null and the static fallbacks apply.
export async function resolveSessionAgent(
  ctx: SessionContext,
): Promise<ResolvedAgent | null> {
  const caller = tenantCallerOrNull(ctx);
  const agentId = ctx.session.auth.current?.attributes?.agentId;
  if (!caller || typeof agentId !== "string") return null;

  const { data } = await serviceClient()
    .from("agents")
    .select("id, name, config, status, archived_at")
    .eq("id", agentId)
    .eq("property_id", caller.propertyId)
    .maybeSingle();
  if (!data || data.status !== "active" || data.archived_at) return null;

  return {
    caller,
    agentId: data.id,
    name: data.name,
    config: parseAgentConfig(data.config),
  };
}
