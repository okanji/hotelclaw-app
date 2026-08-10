import { defineDynamic, defineTool } from "eve/tools";
import {
  brainToolDescriptions,
  brainToolSchemas,
  normalizeListPages,
  operatorReviewPage,
} from "@hotelclaw/brain";
import { CHANNEL_BOT_SLUG } from "../lib/agent-config";
import { tenantCallerOrNull } from "../lib/tenant";
import { resolvePropertyBrainBinding } from "../lib/property-brain";
import { callBrainToolDirect } from "../lib/gbrain-http";
import { resolveBrainSources } from "../lib/brain-citations";

// Shared-brain tools for the DEFAULT CHANNEL BOT sessions (virtual agent
// `hotelclaw` — lib/agent-config.ts). The full read ladder (search → get/
// list → think) + one disciplined write, matching the web Tier-1 surface
// (apps/web/lib/ai/tools/gbrain.ts) — descriptions/schemas come from
// @hotelclaw/brain so the surfaces cannot drift. Tenancy = the OAuth client
// the property resolves to; fail-soft: no binding ⇒ no tools.
//
// eve constraint: every execute INLINE (replay reconstruction).

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      // Same structural pass-through the other dynamic resolvers use — the
      // resolve context carries session.auth identically to SessionContext.
      const caller = tenantCallerOrNull(
        ctx as unknown as Parameters<typeof tenantCallerOrNull>[0],
      );
      const botSlug = ctx.session.auth.current?.attributes?.botSlug;
      const agentId = ctx.session.auth.current?.attributes?.agentId;
      if (!caller || typeof agentId === "string" || botSlug !== CHANNEL_BOT_SLUG) {
        return null;
      }
      const binding = await resolvePropertyBrainBinding(caller.propertyId);
      if (!binding) return null;
      const brainMcpUrl = binding.url;
      // Plain string capture (never the `caller` object) — the eve build
      // transform lifts executes and can only serialize plain values.
      const brainPropertyId = caller.propertyId;
      const brainCred = { clientId: binding.clientId, clientSecret: binding.clientSecret };

      return {
        brain_search: defineTool({
          description: brainToolDescriptions.brain_search,
          inputSchema: brainToolSchemas.brain_search,
          async execute({ query, limit }) {
            const result = await callBrainToolDirect(brainMcpUrl, brainCred, "search", {
              query,
              limit,
            });
            if (!result.ok) return { unavailable: true, reason: result.reason };
            // Mirrored app documents come back as `documents/<uuid>` slugs.
            // Resolve them so the model cites titles, not raw UUIDs.
            const sources = await resolveBrainSources(brainPropertyId, result.content);
            return sources.length > 0
              ? { results: result.content, sources }
              : { results: result.content };
          },
        }),
        brain_think: defineTool({
          description: brainToolDescriptions.brain_think,
          inputSchema: brainToolSchemas.brain_think,
          async execute({ question }) {
            const result = await callBrainToolDirect(
              brainMcpUrl,
              brainCred,
              "think",
              { question },
              { timeoutMs: 60_000 },
            );
            if (!result.ok) return { unavailable: true, reason: result.reason };
            const sources = await resolveBrainSources(brainPropertyId, result.content);
            return sources.length > 0
              ? { answer: result.content, sources }
              : { answer: result.content };
          },
        }),
        brain_get: defineTool({
          description: brainToolDescriptions.brain_get,
          inputSchema: brainToolSchemas.brain_get,
          async execute({ slug }) {
            const result = await callBrainToolDirect(brainMcpUrl, brainCred, "get_page", {
              slug,
            });
            if (!result.ok) return { unavailable: true, reason: result.reason };
            const page =
              typeof result.content === "string"
                ? result.content
                : ((result.content as { content?: string; markdown?: string } | null)
                    ?.content ??
                  (result.content as { markdown?: string } | null)?.markdown ??
                  "");
            if (!page) return { found: false, slug };
            const sources = await resolveBrainSources(brainPropertyId, slug);
            return sources.length > 0
              ? { found: true, slug, markdown: page.slice(0, 20_000), sources }
              : { found: true, slug, markdown: page.slice(0, 20_000) };
          },
        }),
        brain_list: defineTool({
          description: brainToolDescriptions.brain_list,
          inputSchema: brainToolSchemas.brain_list,
          async execute({ prefix, limit }) {
            const result = await callBrainToolDirect(brainMcpUrl, brainCred, "list_pages", {
              ...(prefix ? { prefix } : {}),
              limit,
              sort: "updated_desc",
            });
            if (!result.ok) return { unavailable: true, reason: result.reason };
            const listed = normalizeListPages(result.content);
            const filtered = prefix
              ? listed.pages.filter((p) => p.slug.startsWith(prefix))
              : listed.pages;
            const capped = filtered.slice(0, limit);
            // Enumeration is the one read where the model shows titles to a
            // human verbatim ("what SOPs do we have"). The serve's stored
            // title can be slug-derived for older mirror pages, so swap in
            // the document's real app title — the same resolution search/get
            // already do, applied to the list itself rather than a footnote.
            const sources = await resolveBrainSources(brainPropertyId, capped);
            const byslug = new Map(sources.map((s) => [s.slug, s]));
            const pages = capped.map((p) => {
              const source = byslug.get(p.slug);
              return source ? { ...p, title: source.title, link: source.link } : p;
            });
            return sources.length > 0
              ? { count: pages.length, pages, sources }
              : { count: pages.length, pages };
          },
        }),
        brain_capture: defineTool({
          description: brainToolDescriptions.brain_capture,
          inputSchema: brainToolSchemas.brain_capture,
          async execute({ slug, page_title, observation, source }) {
            const existing = await callBrainToolDirect(brainMcpUrl, brainCred, "get_page", {
              slug,
            });
            if (!existing.ok) {
              const created = await callBrainToolDirect(brainMcpUrl, brainCred, "put_page", {
                slug,
                content: operatorReviewPage(page_title),
                ingested_via: "hotelclaw-channel-bot",
              });
              if (!created.ok) return { captured: false, reason: created.reason };
            }
            const entry = await callBrainToolDirect(brainMcpUrl, brainCred, "add_timeline_entry", {
              slug,
              date: new Date().toISOString().slice(0, 10),
              summary: observation,
              source,
            });
            return entry.ok
              ? { captured: true, slug }
              : { captured: false, reason: entry.reason };
          },
        }),
      };
    },
  },
});
