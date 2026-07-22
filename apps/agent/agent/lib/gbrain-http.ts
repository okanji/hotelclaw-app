/**
 * Eve-side wrappers over the shared gbrain transport in @hotelclaw/brain
 * (token exchange, SSE-aware tools/call — one implementation for both
 * runtimes). This module keeps the historical call signatures used across
 * the agent: env-ref credentials (pod clients) and direct credentials
 * (property_brains rows).
 *
 * Fail-soft by design: unconfigured/unreachable brains yield
 * { ok:false, reason } — bots degrade, never error. Tokens and URLs stay
 * out of prompts and history.
 */
import {
  callBrain,
  getBrainPageMarkdown,
  type BrainCredential,
  type BrainResult,
} from "@hotelclaw/brain";

export type { BrainResult };

export function resolveBrainCredential(
  tokenRef: string | null,
): BrainCredential | null {
  if (!tokenRef || !/^BRAIN_TOKEN_[A-Z0-9_]+$/.test(tokenRef)) return null;
  const raw = process.env[tokenRef];
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep <= 0) return null;
  return { clientId: raw.slice(0, sep), clientSecret: raw.slice(sep + 1) };
}

export async function callBrainTool(
  brainUrl: string | null,
  tokenRef: string | null,
  tool: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<BrainResult> {
  return callBrain(brainUrl, resolveBrainCredential(tokenRef), tool, args, opts);
}

/** Direct-credential variant (property_brains rows hold clientId/secret
 * rather than an env ref — see lib/property-brain.ts). */
export async function callBrainToolDirect(
  brainUrl: string | null,
  cred: BrainCredential | null,
  tool: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<BrainResult> {
  return callBrain(brainUrl, cred, tool, args, opts);
}

/** Hybrid query with keyword fallback (vector arm is dark until an
 * embedding provider key is configured). */
export async function brainQuery(
  brainUrl: string | null,
  tokenRef: string | null,
  query: string,
): Promise<BrainResult> {
  const cred = resolveBrainCredential(tokenRef);
  const hybrid = await callBrain(brainUrl, cred, "query", { query });
  if (hybrid.ok) {
    const empty =
      hybrid.content == null ||
      (Array.isArray(hybrid.content) && hybrid.content.length === 0) ||
      hybrid.content === "";
    if (!empty) return hybrid;
  }
  return callBrain(brainUrl, cred, "search", { query });
}

/** Fetch a single page's markdown (persona/skill resolvers + brain_get). */
export async function getBrainPage(
  brainUrl: string | null,
  tokenRef: string | null,
  path: string,
): Promise<string | null> {
  return getBrainPageMarkdown(brainUrl, resolveBrainCredential(tokenRef), path);
}

/** Write/update a page (outcomes hook). */
export async function putBrainPage(
  brainUrl: string | null,
  tokenRef: string | null,
  path: string,
  markdown: string,
): Promise<BrainResult> {
  return callBrain(brainUrl, resolveBrainCredential(tokenRef), "put_page", {
    slug: path,
    content: markdown,
  });
}
