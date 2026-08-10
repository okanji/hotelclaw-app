/**
 * @hotelclaw/brain — the ONE definition of everything gbrain-facing that
 * was previously copy-pasted between apps/web and apps/agent with
 * "keep in sync" comments (transport, capture shape, crypto derivation,
 * tool descriptions). Tenant isolation stays where it always was: the
 * OAuth CLIENT (write-source binding + federated-read allow-list enforced
 * by the serve) — never in tool args.
 *
 * Each app keeps its own binding RESOLVER (they read different Supabase
 * clients) and its own tool executors (eve requires inline `execute`);
 * this package owns the pure parts they share.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrainCredential = { clientId: string; clientSecret: string };

export type BrainResult =
  | { ok: true; content: unknown }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Transport — OAuth client_credentials + MCP tools/call over streamable HTTP
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(
  brainUrl: string,
  cred: BrainCredential,
): Promise<string | null> {
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

/** Call one MCP tool on the shared serve. Fail-soft: every failure mode
 * returns { ok:false, reason } — bots degrade, never throw. */
export async function callBrain(
  brainUrl: string | null,
  cred: BrainCredential | null,
  tool: string,
  args: Record<string, unknown>,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<BrainResult> {
  if (!brainUrl) return { ok: false, reason: "brain endpoint not configured" };
  if (!cred) return { ok: false, reason: "brain credential unavailable" };
  const token = await accessToken(brainUrl, cred);
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
      // The serve KEEPS THE SSE STREAM OPEN after replying (verified on the
      // shared Postgres serve) — `response.text()` hangs until timeout.
      // Read to the first complete `data:` line, then cancel.
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

/** Fetch a page's markdown, or null (missing page and transport failure
 * both resolve null — callers that must distinguish use callBrain). */
export async function getBrainPageMarkdown(
  brainUrl: string | null,
  cred: BrainCredential | null,
  slug: string,
): Promise<string | null> {
  const result = await callBrain(brainUrl, cred, "get_page", { slug });
  if (!result.ok) return null;
  if (typeof result.content === "string") return result.content || null;
  const page = result.content as { content?: string; markdown?: string } | null;
  return page?.content ?? page?.markdown ?? null;
}

// ---------------------------------------------------------------------------
// Capture — the ONE disciplined write shape (append evidence, never rewrite
// compiled truth; that stays human/dream-cycle territory)
// ---------------------------------------------------------------------------

export function operatorReviewPage(pageTitle: string): string {
  return `# ${pageTitle}\n\n> ⚠️ OPERATOR REVIEW — page created automatically from app activity; compile the truth above the line as evidence accumulates.\n`;
}

export async function captureEvidence(
  brainUrl: string | null,
  cred: BrainCredential | null,
  input: {
    slug: string;
    pageTitle: string;
    summary: string;
    detail?: string;
    source: string;
    /** Provenance label for page creation (server-stamped for remote
     * callers; still passed for local/CLI parity). */
    ingestedVia?: string;
  },
): Promise<BrainResult> {
  if (!brainUrl || !cred) return { ok: false, reason: "brain not configured" };
  const existing = await getBrainPageMarkdown(brainUrl, cred, input.slug);
  if (existing === null) {
    const created = await callBrain(brainUrl, cred, "put_page", {
      slug: input.slug,
      content: operatorReviewPage(input.pageTitle),
      ingested_via: input.ingestedVia ?? "hotelclaw-app",
    });
    if (!created.ok) return created;
  }
  return callBrain(brainUrl, cred, "add_timeline_entry", {
    slug: input.slug,
    date: new Date().toISOString().slice(0, 10),
    summary: input.summary,
    ...(input.detail ? { detail: input.detail.slice(0, 4000) } : {}),
    source: input.source,
  });
}

// ---------------------------------------------------------------------------
// At-rest crypto for property_brains OAuth secrets (AES-256-GCM). The key
// derivation context is part of the row format — both apps MUST derive
// identically, which is why it lives here and only here.
// ---------------------------------------------------------------------------

function brainKey(secretMaterial: string): Buffer {
  return createHash("sha256").update(`${secretMaterial}:property-brains`).digest();
}

export function encryptBrainSecretWith(
  secretMaterial: string,
  plaintext: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", brainKey(secretMaterial), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

/** Returns null on any tampering/format mismatch rather than throwing. */
export function decryptBrainSecretWith(
  secretMaterial: string,
  ciphertext: string,
): string | null {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      brainKey(secretMaterial),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Curated tool surface — descriptions + input schemas for the FIVE bot-facing
// brain tools. The serve exposes ~100 ops; bots get a read ladder
// (search → get/list → think) and one disciplined write (capture).
// Executors live in each runtime (eve needs them inline); the words and
// shapes live here so they cannot drift again.
// ---------------------------------------------------------------------------

export const BRAIN_CITATION_FORMAT =
  "[brain: <source>/<page-slug>]" as const;

export const brainToolDescriptions = {
  // 2026-08-06 audit: `search` IS hybrid (vector + keyword), verified against
  // the live serve — "what happens when the chiller gets too warm" surfaces
  // the walk-in freezer SOP even though the word "chiller" appears nowhere in
  // it. Mid-audit this looked keyword-only and the description briefly said
  // so; the real cause was corpus state (22 pages never evaluated against the
  // contextual-retrieval ladder, plus chunks split across two embedding
  // models after a provider switch). `gbrain reindex --markdown` fixed it.
  // If semantic recall ever looks dead again, check corpus health FIRST —
  // `content_chunks.model` should be one value, and doctor's
  // contextual_retrieval_coverage should be clean.
  brain_search:
    "Search the property's shared knowledge brain (institutional memory: past incidents and fixes, supplier quirks, guest history, playbooks, team lore — plus a mirror of the property's documents). Hybrid retrieval — matches on MEANING as well as words, so a question phrased in your own vocabulary still finds the right page. Use FIRST for anything that smells like 'have we seen this before'. Chunks are excerpts — follow up with brain_get on a promising slug for the full page. The best hit is not always rank 1; scan the top few.",
  brain_think:
    "Ask the knowledge brain a HARD question and get a synthesized answer with citations and honest gap analysis. Reads across many pages and composes a real answer rather than handing back excerpts. Slow (~40s) — reserve for questions needing judgment ('why does the pool keep going green?', 'what do we know about this supplier?'), not lookups brain_search can answer.",
  brain_capture:
    "Record a durable observation in the property's shared brain so future conversations — yours and other bots' — benefit. Use for confirmed recurring issues, fixes, supplier behavior, team decisions, guest-relevant lore. SKIP chit-chat and anything already authoritative in the app (tasks, bookings, docs). slug examples: 'systems/pool', 'suppliers/acme-pool-services'.",
  brain_get:
    "Read one full brain page by slug (compiled truth + evidence timeline). Use after brain_search/brain_list surfaces a promising slug — search returns chunks, not full pages.",
  brain_list:
    "List brain pages (slug, title, updated) with an optional slug prefix filter, newest first. Use for 'what does the brain have on/under X' and 'what's recent' questions — listing beats semantic search for enumeration. Prefix examples: 'documents/', 'suppliers/', 'operations/'.",
} as const;

export const brainToolSchemas = {
  brain_search: z.object({
    query: z.string().min(2).max(300),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  brain_think: z.object({
    question: z.string().min(5).max(500),
  }),
  brain_capture: z.object({
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9/_-]{2,80}$/)
      .describe("Entity page path (kebab-case, '/'-separated)"),
    page_title: z.string().min(2).max(120),
    observation: z
      .string()
      .min(10)
      .max(1000)
      .describe("The durable fact, one to three sentences, specific"),
    source: z
      .string()
      .max(140)
      .describe("Where this came from (e.g. 'chat #maintenance, Oamar, 2026-07-19')"),
  }),
  brain_get: z.object({
    slug: z.string().min(2).max(200).describe("Page slug, e.g. 'documents/<id>' or 'suppliers/acme'"),
  }),
  brain_list: z.object({
    prefix: z
      .string()
      .max(120)
      .optional()
      .describe("Slug prefix filter, e.g. 'documents/' or 'operations/'"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
} as const;

/** Normalize a `list_pages` result to a compact, model-friendly shape. */
export function normalizeListPages(content: unknown): {
  count: number;
  pages: Array<{ slug: string; title: string | null; updated: string | null }>;
} {
  const rows: Array<Record<string, unknown>> = Array.isArray(content)
    ? (content as Array<Record<string, unknown>>)
    : Array.isArray((content as { pages?: unknown[] } | null)?.pages)
      ? ((content as { pages: Array<Record<string, unknown>> }).pages)
      : [];
  const pages = rows.map((r) => ({
    slug: String(r.slug ?? r.path ?? ""),
    title: typeof r.title === "string" ? r.title : null,
    updated:
      typeof r.updated_at === "string"
        ? r.updated_at
        : typeof r.updated === "string"
          ? r.updated
          : null,
  }));
  return { count: pages.length, pages };
}

// ---------------------------------------------------------------------------
// Knowledge discipline — the standing rules every knowledge-capable bot gets
// (always-on instructions; the longer lookup procedure ships as a skill).
// ---------------------------------------------------------------------------

export const KNOWLEDGE_DISCIPLINE = [
  "## Finding what the property knows",
  "- Three kinds of source, three jobs: **Documents** (authored SOPs, policies, runbooks, notes — the authoritative record of what's written down), the **knowledge brain** (captured institutional memory plus an automatic mirror of documents; may lag edits by minutes), and **live app data** (tasks, meetings, bookings, forms — transactional truth; never quote these from the brain or memory).",
  "- For ANY question about knowledge, policies, procedures, history, or \"do we have X\": check EVERY relevant mounted surface before answering — document search/listing AND brain search (and the deployment knowledge base where mounted). Keyword search first; brain_think only for hard synthesis questions.",
  "- Enumeration questions (\"what SOPs do we have\", \"list our …\") want listing tools (list_documents, brain_list), not just keyword search.",
  "- An empty result speaks ONLY for the source that returned it. NEVER state that something doesn't exist until every mounted surface has returned empty — and if a surface you'd need isn't mounted, say you can't see it rather than guessing.",
  "- When surfaces disagree in coverage, say which said what: \"Documents has 5 SOPs; the brain has no incident history on this.\" End partial answers with an explicit note on what you could not check.",
  `- Cite brain findings as ${BRAIN_CITATION_FORMAT} and documents by title with their app link. Never present uncited claims as property knowledge.`,
  "- A brain hit whose slug looks like `documents/<uuid>` IS one of those app documents, mirrored. Cite it by TITLE with its app link — never paste the raw slug or uuid at a human. When a tool result carries a `sources` list, it has already resolved those slugs to titles and links: use them verbatim.",
].join("\n");

// ---------------------------------------------------------------------------
// Stream-safe text chunking. Stream Chat SILENTLY DISCARDS messages past
// its ~5KB text limit (the send "succeeds", the message never exists —
// observed 2026-07-23 with a 19KB background-job report). Long deliveries
// must be chunked; continuation chunks post as thread replies.
// ---------------------------------------------------------------------------

export const STREAM_CHUNK_LIMIT = 4200;
export const STREAM_MAX_CHUNKS = 8;

/** Split text into Stream-safe chunks, preferring newline boundaries in
 * the back half of each window. Past maxChunks the tail is dropped with a
 * truncation marker appended to the final chunk. */
export function chunkStreamText(
  text: string,
  {
    limit = STREAM_CHUNK_LIMIT,
    maxChunks = STREAM_MAX_CHUNKS,
  }: { limit?: number; maxChunks?: number } = {},
): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0 && chunks.length < maxChunks) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      remaining = "";
      break;
    }
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0 && chunks.length >= maxChunks) {
    chunks[chunks.length - 1] += "\n\n…(truncated — ask for the rest)";
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Document → brain sync helpers (the doc mirror pages)
// ---------------------------------------------------------------------------

export const DOC_BRAIN_PREFIX = "documents/" as const;
export const DOC_SYNC_INGESTED_VIA = "hotelclaw-doc-sync" as const;

export function documentBrainSlug(documentId: string): string {
  return `${DOC_BRAIN_PREFIX}${documentId}`;
}

const DOC_BODY_CAP = 60_000;

/** Render the mirror page for an app document. Deterministic (no model),
 * link built from ids in code — never composed by an LLM. The whole page is
 * overwritten on every sync: the app's Postgres row is canonical and this
 * page is a derived index, so the compiled-truth/timeline split does not
 * apply here (documented deviation; see plan). */
export function renderDocumentBrainPage(input: {
  title: string;
  href: string;
  bodyText: string;
  updatedAt: string | null;
}): string {
  const body = input.bodyText.trim();
  return [
    `# ${input.title}`,
    "",
    "> App document — mirrored automatically from the property's Documents section.",
    `> Canonical copy (edit there, this page is overwritten on sync): ${input.href}`,
    input.updatedAt ? `> Last updated in app: ${input.updatedAt}` : null,
    "",
    body.length > DOC_BODY_CAP
      ? `${body.slice(0, DOC_BODY_CAP)}\n\n> [truncated — full text in the app]`
      : body || "_(document has no body text yet)_",
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
