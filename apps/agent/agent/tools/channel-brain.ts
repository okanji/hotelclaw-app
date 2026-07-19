import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { CHANNEL_BOT_SLUG } from "../lib/agent-config";
import { tenantCallerOrNull } from "../lib/tenant";
import { resolvePropertyBrainBinding } from "../lib/property-brain";
import { callBrainToolDirect } from "../lib/gbrain-http";

// Shared-brain tools for the DEFAULT CHANNEL BOT sessions (virtual agent
// `hotelclaw` — lib/agent-config.ts). Read ladder + one disciplined write,
// matching the web Tier-1 surface (apps/web/lib/ai/tools/gbrain.ts) so the
// bot behaves identically wherever it runs. Tenancy = the OAuth client the
// property resolves to; fail-soft: no binding ⇒ no tools.
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
          description:
            "Search the property's shared knowledge brain (institutional memory: past incidents and fixes, supplier quirks, guest history, team lore). Cheap hybrid retrieval returning matching chunks. Use FIRST for anything that smells like 'have we seen this before'.",
          inputSchema: z.object({
            query: z.string().min(2).max(300),
            limit: z.number().int().min(1).max(10).default(5),
          }),
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
          description:
            "Ask the knowledge brain a HARD question and get a synthesized answer with citations and honest gap analysis. Expensive — reserve for questions needing judgment across many pages. Not for simple lookups.",
          inputSchema: z.object({
            question: z.string().min(5).max(500),
          }),
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
        brain_capture: defineTool({
          description:
            "Record a durable observation in the property's shared brain so future conversations — yours and other bots' — benefit. Use for confirmed recurring issues, fixes, supplier behavior, team decisions. SKIP chit-chat and anything already authoritative in the app (tasks, bookings, docs). slug examples: 'systems/pool', 'suppliers/acme-pool-services'.",
          inputSchema: z.object({
            slug: z.string().regex(/^[a-z0-9][a-z0-9/_-]{2,80}$/),
            page_title: z.string().min(2).max(120),
            observation: z.string().min(10).max(1000),
            source: z.string().max(140),
          }),
          async execute({ slug, page_title, observation, source }) {
            const existing = await callBrainToolDirect(url, cred, "get_page", {
              slug,
            });
            if (!existing.ok) {
              const created = await callBrainToolDirect(url, cred, "put_page", {
                slug,
                content: `# ${page_title}\n\n> ⚠️ OPERATOR REVIEW — page created automatically from app activity; compile the truth above the line as evidence accumulates.\n`,
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
