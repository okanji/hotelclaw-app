import "server-only";
/**
 * Web-side client for the SHARED gbrain server (fleet v2: ONE serve, many
 * sources; tenancy = the OAuth client, whose write-source binding and
 * federated-read allow-list are enforced server-side — never in tool args).
 *
 * Per-property resolution (resolvePropertyBrain):
 *   1. Pod property → the pod client's credentials (clients row env ref —
 *      Tier-1 bots share the pod's brain source, so channel-bot captures
 *      and pod-bot knowledge compound together).
 *   2. property_brains row → per-property source + encrypted OAuth client
 *      (provisioned via scripts/provision-property-brain.mjs).
 *   3. null → bots run brainless (fail-soft, the historical behavior).
 *
 * Transport (token exchange, SSE-aware tools/call) and the capture shape
 * live in @hotelclaw/brain — shared with the eve runtime. This module owns
 * only the web-side binding resolution + thin wrappers keeping the
 * historical call signatures.
 */
import {
  callBrain,
  captureEvidence,
  getBrainPageMarkdown,
  type BrainResult,
} from "@hotelclaw/brain";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptBrainSecret } from "@/lib/brain/crypto";

export type BrainBinding = {
  url: string;
  clientId: string;
  clientSecret: string;
  source: string;
};

export type { BrainResult };

const bindingCache = new Map<string, { binding: BrainBinding | null; at: number }>();
const BINDING_TTL_MS = 5 * 60_000;
// Null results get a SHORT ttl — a transient resolution failure must not
// leave surfaces brainless for 5 minutes.
const NULL_TTL_MS = 30_000;

/**
 * Drop a cached binding. Must be called after (re)provisioning: the cache
 * would otherwise keep handing out the OLD credential for up to
 * BINDING_TTL_MS, so a repair would appear to do nothing for 5 minutes.
 */
export function invalidatePropertyBrain(propertyId: string): void {
  bindingCache.delete(propertyId);
}

export async function resolvePropertyBrain(
  propertyId: string,
): Promise<BrainBinding | null> {
  const cached = bindingCache.get(propertyId);
  if (
    cached &&
    Date.now() - cached.at < (cached.binding ? BINDING_TTL_MS : NULL_TTL_MS)
  ) {
    return cached.binding;
  }

  const url = process.env.BRAIN_MCP_URL;
  let binding: BrainBinding | null = null;
  if (url) {
    const service = createServiceClient();
    const { data: property } = await service
      .from("properties")
      .select("client_id")
      .eq("id", propertyId)
      .maybeSingle();

    // (1) Pod property: reuse the pod's OAuth client.
    if (property?.client_id) {
      const { data: client } = await service
        .from("clients")
        .select("brain_source, brain_client_secret_ref, status")
        .eq("id", property.client_id)
        .maybeSingle();
      if (client?.status === "active" && client.brain_source) {
        const raw = /^BRAIN_TOKEN_[A-Z0-9_]+$/.test(client.brain_client_secret_ref)
          ? process.env[client.brain_client_secret_ref]
          : undefined;
        const sep = raw?.indexOf(":") ?? -1;
        if (raw && sep > 0) {
          binding = {
            url,
            clientId: raw.slice(0, sep),
            clientSecret: raw.slice(sep + 1),
            source: client.brain_source,
          };
        }
      }
    }

    // (2) Provisioned per-property binding.
    if (!binding) {
      const { data: row } = await service
        .from("property_brains")
        .select("source, client_id, client_secret_enc")
        .eq("property_id", propertyId)
        .maybeSingle();
      if (row) {
        const secret = decryptBrainSecret(row.client_secret_enc);
        if (secret) {
          binding = {
            url,
            clientId: row.client_id,
            clientSecret: secret,
            source: row.source,
          };
        }
      }
    }
  }

  bindingCache.set(propertyId, { binding, at: Date.now() });
  return binding;
}

export async function callBrainTool(
  binding: BrainBinding | null,
  tool: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<BrainResult> {
  if (!binding) return { ok: false, reason: "brain not configured" };
  return callBrain(binding.url, binding, tool, args, opts);
}

/** Fetch a page's markdown, or null. */
export async function getBrainPage(
  binding: BrainBinding | null,
  slug: string,
): Promise<string | null> {
  if (!binding) return null;
  return getBrainPageMarkdown(binding.url, binding, slug);
}

/**
 * Append durable evidence: ensure the page exists, then add a timeline
 * entry. The compiled-truth half of the page is left to humans/the dream
 * cycle — bots append evidence, they don't rewrite understanding.
 */
export async function captureToBrain(
  binding: BrainBinding | null,
  input: {
    slug: string;
    pageTitle: string;
    summary: string;
    detail?: string;
    source: string;
  },
): Promise<BrainResult> {
  if (!binding) return { ok: false, reason: "brain not configured" };
  return captureEvidence(binding.url, binding, input);
}
