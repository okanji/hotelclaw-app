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
 * Transport notes (learned on the fleet build, keep in sync with
 * apps/agent/agent/lib/gbrain-http.ts): client_credentials exchange at
 * <origin>/token with a cached access token; the MCP serve replies over
 * SSE and KEEPS THE STREAM OPEN — read the first complete `data:` line
 * and cancel, `response.text()` hangs.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { decryptBrainSecret } from "@/lib/brain/crypto";

export type BrainBinding = {
  url: string;
  clientId: string;
  clientSecret: string;
  source: string;
};

export type BrainResult =
  | { ok: true; content: unknown }
  | { ok: false; reason: string };

const bindingCache = new Map<string, { binding: BrainBinding | null; at: number }>();
const BINDING_TTL_MS = 5 * 60_000;
// Null results get a SHORT ttl — a transient resolution failure must not
// leave surfaces brainless for 5 minutes.
const NULL_TTL_MS = 30_000;

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

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(binding: BrainBinding): Promise<string | null> {
  const origin = new URL(binding.url).origin;
  const cacheKey = `${origin}:${binding.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  try {
    const response = await fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: binding.clientId,
        client_secret: binding.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) return null;
    tokenCache.set(cacheKey, {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    });
    return body.access_token;
  } catch {
    return null;
  }
}

let rpcId = 0;

export async function callBrainTool(
  binding: BrainBinding | null,
  tool: string,
  args: Record<string, unknown>,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<BrainResult> {
  if (!binding) return { ok: false, reason: "brain not configured" };
  const token = await accessToken(binding);
  if (!token) return { ok: false, reason: "brain credential unavailable" };

  try {
    const response = await fetch(binding.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++rpcId,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, reason: `brain returned ${response.status}` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    let payload: {
      result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
      error?: { message?: string };
    };
    if (contentType.includes("text/event-stream")) {
      if (!response.body) return { ok: false, reason: "empty brain response" };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let dataLine: string | null = null;
      try {
        while (dataLine === null) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.includes("\n")) {
            const complete = buffer
              .slice(0, buffer.lastIndexOf("\n"))
              .split("\n")
              .filter((l) => l.startsWith("data:"));
            if (complete.length > 0) dataLine = complete[complete.length - 1];
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
      if (!dataLine) return { ok: false, reason: "empty brain response" };
      payload = JSON.parse(dataLine.slice(5));
    } else {
      payload = await response.json();
    }
    if (payload.error) {
      return { ok: false, reason: payload.error.message ?? "brain error" };
    }
    const text = (payload.result?.content ?? [])
      .filter((b) => b && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
    if (payload.result?.isError) {
      return { ok: false, reason: text.slice(0, 300) || "brain tool error" };
    }
    try {
      return { ok: true, content: JSON.parse(text) };
    } catch {
      return { ok: true, content: text };
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "brain unreachable",
    };
  }
}

/** Fetch a page's markdown, or null. */
export async function getBrainPage(
  binding: BrainBinding | null,
  slug: string,
): Promise<string | null> {
  const result = await callBrainTool(binding, "get_page", { slug });
  if (!result.ok) return null;
  if (typeof result.content === "string") return result.content || null;
  const page = result.content as { content?: string; markdown?: string } | null;
  return page?.content ?? page?.markdown ?? null;
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
  const existing = await getBrainPage(binding, input.slug);
  if (existing === null) {
    const created = await callBrainTool(binding, "put_page", {
      slug: input.slug,
      content: `# ${input.pageTitle}\n\n> ⚠️ OPERATOR REVIEW — page created automatically from app activity; compile the truth above the line as evidence accumulates.\n`,
      ingested_via: "hotelclaw-app",
    });
    if (!created.ok) return created;
  }
  return callBrainTool(binding, "add_timeline_entry", {
    slug: input.slug,
    date: new Date().toISOString().slice(0, 10),
    summary: input.summary,
    ...(input.detail ? { detail: input.detail.slice(0, 4000) } : {}),
    source: input.source,
  });
}
