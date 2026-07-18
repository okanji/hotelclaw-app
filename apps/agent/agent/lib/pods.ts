import type { SessionContext } from "eve/context";
import { serviceClient } from "./supabase";
import { tenantCallerOrNull, type TenantCaller } from "./tenant";

export type PodBot = {
  id: string;
  botSlug: string;
  displayName: string;
  personaFallback: string | null;
  toolSet: Set<string>;
  modelTier: "standard" | "advanced";
};

export type PodContext = {
  caller: TenantCaller;
  clientId: string;
  clientSlug: string;
  brainUrl: string | null;
  brainTokenRef: string | null;
  propertySlug: string;
  bot: PodBot | null;
};

/**
 * The pod dimension of a session (fleet spec M2): the caller's property's
 * client (= pod), its brain endpoint config, and — when the session
 * addresses a pod bot (x-hotelclaw-bot header stamped by channel auth) —
 * that bot's row. Null when the property belongs to no client (the
 * pre-pod demo world keeps working).
 *
 * Brain URL + token stay OUT of prompts and history: they are resolved
 * here (server-side) and consumed by lib/gbrain-http only.
 */
export async function resolvePodContext(
  ctx: SessionContext,
): Promise<PodContext | null> {
  const caller = tenantCallerOrNull(ctx);
  if (!caller) return null;

  const supabase = serviceClient();
  const { data: property } = await supabase
    .from("properties")
    .select("slug, client_id")
    .eq("id", caller.propertyId)
    .maybeSingle();
  if (!property?.client_id) return null;

  const { data: client } = await supabase
    .from("clients")
    .select("id, slug, brain_source, brain_client_secret_ref, status")
    .eq("id", property.client_id)
    .maybeSingle();
  if (!client || client.status !== "active") return null;

  let bot: PodBot | null = null;
  const botSlug = ctx.session.auth.current?.attributes?.botSlug;
  if (typeof botSlug === "string" && botSlug) {
    const { data } = await supabase
      .from("bots")
      .select("id, bot_id, display_name, persona_fallback, tool_set, model_tier")
      .eq("client_id", client.id)
      .eq("bot_id", botSlug)
      .maybeSingle();
    if (data) {
      bot = {
        id: data.id,
        botSlug: data.bot_id,
        displayName: data.display_name,
        personaFallback: data.persona_fallback,
        toolSet: new Set(data.tool_set ?? []),
        modelTier: data.model_tier === "advanced" ? "advanced" : "standard",
      };
    }
  }

  return {
    caller,
    clientId: client.id,
    clientSlug: client.slug,
    // Fleet v2: ONE shared brain server; the pod's OAuth client (bound to
    // its source server-side) is the tenancy boundary. No per-client URL.
    brainUrl: client.brain_source ? (process.env.BRAIN_MCP_URL ?? null) : null,
    brainTokenRef: client.brain_client_secret_ref || null,
    propertySlug: property.slug,
    bot,
  };
}
