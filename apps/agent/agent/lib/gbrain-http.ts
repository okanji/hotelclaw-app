/**
 * HTTP client for gbrain's MCP endpoints (fleet spec M2/M0, connection
 * option (b): brain access via authored tools + this helper).
 *
 * Auth (verified against gbrain 0.42.62): `gbrain serve --http` speaks MCP
 * streamable HTTP with OAuth 2.1. BRAIN_TOKEN_* env refs hold
 * "clientId:clientSecret"; this module exchanges them via the
 * client_credentials grant at <origin>/token and caches the access token
 * until shortly before expiry. Scopes enforce read-only for the master
 * brain (put_page rejected with insufficient_scope — drilled).
 *
 * Real op names (94-tool surface): `query` {query}, `search` {query},
 * `get_page` {slug}, `put_page` {slug, content}, `delete_page` {slug}.
 * Without embedding keys `query`'s vector arm is dark, so brainQuery falls
 * back to keyword `search` when `query` returns nothing.
 *
 * Fail-soft by design: unconfigured/unreachable brains yield
 * { ok:false, reason } — bots degrade, never error. Tokens and URLs stay
 * out of prompts and history.
 */

export type BrainResult =
  | { ok: true; content: unknown }
  | { ok: false; reason: string };

export function resolveBrainCredential(
  tokenRef: string | null,
): { clientId: string; clientSecret: string } | null {
  if (!tokenRef || !/^BRAIN_TOKEN_[A-Z0-9_]+$/.test(tokenRef)) return null;
  const raw = process.env[tokenRef];
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep <= 0) return null;
  return { clientId: raw.slice(0, sep), clientSecret: raw.slice(sep + 1) };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(
  brainUrl: string,
  tokenRef: string | null,
): Promise<string | null> {
  const cred = resolveBrainCredential(tokenRef);
  if (!cred) return null;
  const origin = new URL(brainUrl).origin;
  const cacheKey = `${origin}:${cred.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  try {
    const response = await fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cred.clientId,
        client_secret: cred.clientSecret,
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
  brainUrl: string | null,
  tokenRef: string | null,
  tool: string,
  args: Record<string, unknown>,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<BrainResult> {
  if (!brainUrl) return { ok: false, reason: "brain endpoint not configured" };
  const token = await accessToken(brainUrl, tokenRef);
  if (!token) return { ok: false, reason: "brain credential unavailable" };

  try {
    const response = await fetch(brainUrl, {
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
      // The server keeps the SSE stream OPEN after replying (verified on the
      // shared Postgres serve) — `response.text()` would hang until the
      // request timeout. Stream-read until the first complete `data:` line,
      // then cancel.
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
          for (const line of buffer.split("\n")) {
            if (line.startsWith("data:") && buffer.includes("\n")) {
              // Only accept the line once its terminating newline arrived.
              const upToNewline = buffer.slice(0, buffer.lastIndexOf("\n"));
              const complete = upToNewline
                .split("\n")
                .filter((l) => l.startsWith("data:"));
              if (complete.length > 0) dataLine = complete[complete.length - 1];
              break;
            }
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
    // Tool payloads are JSON-encoded text blocks; return parsed when possible.
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

/** Hybrid query with keyword fallback (vector arm is dark until an
 * embedding provider key is configured). */
export async function brainQuery(
  brainUrl: string | null,
  tokenRef: string | null,
  query: string,
): Promise<BrainResult> {
  const hybrid = await callBrainTool(brainUrl, tokenRef, "query", { query });
  if (hybrid.ok) {
    const empty =
      hybrid.content == null ||
      (Array.isArray(hybrid.content) && hybrid.content.length === 0) ||
      hybrid.content === "";
    if (!empty) return hybrid;
  }
  return callBrainTool(brainUrl, tokenRef, "search", { query });
}

/** Fetch a single page's markdown (persona/skill resolvers + brain_get). */
export async function getBrainPage(
  brainUrl: string | null,
  tokenRef: string | null,
  path: string,
): Promise<string | null> {
  const result = await callBrainTool(brainUrl, tokenRef, "get_page", {
    slug: path,
  });
  if (!result.ok) return null;
  if (typeof result.content === "string") return result.content || null;
  const page = result.content as { content?: string; markdown?: string } | null;
  return page?.content ?? page?.markdown ?? null;
}

/** Write/update a page (outcomes hook + brain_write). */
export async function putBrainPage(
  brainUrl: string | null,
  tokenRef: string | null,
  path: string,
  markdown: string,
): Promise<BrainResult> {
  return callBrainTool(brainUrl, tokenRef, "put_page", {
    slug: path,
    content: markdown,
  });
}
