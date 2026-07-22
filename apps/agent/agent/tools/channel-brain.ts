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
      const url = binding.url;
      const cred = { clientId: binding.clientId, clientSecret: binding.clientSecret };

      return {
        brain_search: defineTool({
          description: brainToolDescriptions.brain_search,
          inputSchema: brainToolSchemas.brain_search,
          async execute({ query, limit }) {
            const result = await callBrainToolDirect(url, cred, "search", {
              query,
              limit,
            });
            return result.ok
              ? { results: result.content }
              : { unavailable: true, reason: result.reason };
          },
        }),
        brain_think: defineTool({
          description: brainToolDescriptions.brain_think,
          inputSchema: brainToolSchemas.brain_think,
          async execute({ question }) {
            const result = await callBrainToolDirect(
              url,
              cred,
              "think",
              { question },
              { timeoutMs: 60_000 },
            );
            return result.ok
              ? { answer: result.content }
              : { unavailable: true, reason: result.reason };
          },
        }),
        brain_get: defineTool({
          description: brainToolDescriptions.brain_get,
          inputSchema: brainToolSchemas.brain_get,
          async execute({ slug }) {
            const result = await callBrainToolDirect(url, cred, "get_page", {
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
            return { found: true, slug, markdown: page.slice(0, 20_000) };
          },
        }),
        brain_list: defineTool({
          description: brainToolDescriptions.brain_list,
          inputSchema: brainToolSchemas.brain_list,
          async execute({ prefix, limit }) {
            const result = await callBrainToolDirect(url, cred, "list_pages", {
              ...(prefix ? { prefix } : {}),
              limit,
              sort: "updated_desc",
            });
            if (!result.ok) return { unavailable: true, reason: result.reason };
            const listed = normalizeListPages(result.content);
            const pages = prefix
              ? listed.pages.filter((p) => p.slug.startsWith(prefix))
              : listed.pages;
            return { count: pages.length, pages: pages.slice(0, limit) };
          },
        }),
        brain_capture: defineTool({
          description: brainToolDescriptions.brain_capture,
          inputSchema: brainToolSchemas.brain_capture,
          async execute({ slug, page_title, observation, source }) {
            const existing = await callBrainToolDirect(url, cred, "get_page", {
              slug,
            });
            if (!existing.ok) {
              const created = await callBrainToolDirect(url, cred, "put_page", {
                slug,
                content: operatorReviewPage(page_title),
                ingested_via: "hotelclaw-channel-bot",
              });
              if (!created.ok) return { captured: false, reason: created.reason };
            }
            const entry = await callBrainToolDirect(url, cred, "add_timeline_entry", {
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
