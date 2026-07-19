/**
 * Per-property brain binding for the eve runtime — MIRROR of the web
 * side's lib/brain/client.ts resolution (keep the two in sync):
 *   1. Pod property → the pod client's env-ref credential (same source as
 *      the pod bots, so channel-bot captures compound with pod knowledge).
 *   2. property_brains row → per-property source + AES-GCM-encrypted OAuth
 *      client (decrypted here; provisioned by
 *      apps/web/scripts/provision-property-brain.mjs).
 *   3. null → session runs brainless (fail-soft).
 */
import { serviceClient } from "./supabase";
import { decryptBrainSecret } from "./brain-crypto";
import { resolveBrainCredential } from "./gbrain-http";

export type PropertyBrainBinding = {
  url: string;
  clientId: string;
  clientSecret: string;
  source: string;
};

const cache = new Map<string, { binding: PropertyBrainBinding | null; at: number }>();
const TTL_MS = 5 * 60_000;
// Null results get a SHORT ttl: a transient resolution failure (cold DB
// connection right after boot) must not condemn 5 minutes of sessions to
// run brainless — tools resolve once per session at session.started.
const NULL_TTL_MS = 30_000;

export async function resolvePropertyBrainBinding(
  propertyId: string,
): Promise<PropertyBrainBinding | null> {
  const cached = cache.get(propertyId);
  if (
    cached &&
    Date.now() - cached.at < (cached.binding ? TTL_MS : NULL_TTL_MS)
  ) {
    return cached.binding;
  }

  const url = process.env.BRAIN_MCP_URL;
  let binding: PropertyBrainBinding | null = null;
  if (url) {
    const sb = serviceClient();
    const { data: property } = await sb
      .from("properties")
      .select("client_id")
      .eq("id", propertyId)
      .maybeSingle();

    if (property?.client_id) {
      const { data: client } = await sb
        .from("clients")
        .select("brain_source, brain_client_secret_ref, status")
        .eq("id", property.client_id)
        .maybeSingle();
      if (client?.status === "active" && client.brain_source) {
        const cred = resolveBrainCredential(client.brain_client_secret_ref);
        if (cred) {
          binding = { url, ...cred, source: client.brain_source };
        }
      }
    }

    if (!binding) {
      const { data: row } = await sb
        .from("property_brains")
        .select("source, client_id, client_secret_enc")
        .eq("property_id", propertyId)
        .maybeSingle();
      if (row) {
        const secret = decryptBrainSecret(row.client_secret_enc as string);
        if (secret) {
          binding = {
            url,
            clientId: row.client_id as string,
            clientSecret: secret,
            source: row.source as string,
          };
        }
      }
    }
  }

  cache.set(propertyId, { binding, at: Date.now() });
  return binding;
}
