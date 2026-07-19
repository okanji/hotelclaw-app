import "server-only";
/**
 * Shared-brain tools for Tier-1 bots — a CURATED surface over the shared
 * gbrain server (fleet v2), not raw MCP schema discovery. The serve
 * exposes ~94 ops; dumping them all into every bot's tool map buries the
 * useful ones. We expose the read ladder + one disciplined write:
 *
 *   • search  — cheap hybrid retrieval (works even before embeddings)
 *   • think   — LLM-synthesized answer with citations + gap analysis
 *   • capture — append durable evidence to an entity page's timeline
 *
 * Tenant isolation lives in the OAuth CLIENT the property resolves to
 * (write-source binding + federated-read allow-list enforced by the
 * serve) — never in tool args. Fail-soft: unresolved binding ⇒ empty
 * tool set, bots run brainless exactly as before.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { BotScope } from "@/lib/ai/run-bot";
import {
  callBrainTool,
  captureToBrain,
  resolvePropertyBrain,
} from "@/lib/brain/client";

export async function buildGbrainTools(scope: BotScope): Promise<ToolSet> {
  const binding = await resolvePropertyBrain(scope.propertyId);
  if (!binding) return {};

  return {
    search: tool({
      description:
        "Search the property's shared knowledge brain (institutional memory: past incidents and fixes, supplier quirks, guest history, playbooks, team lore). Cheap hybrid retrieval returning matching chunks. Use FIRST for anything that smells like 'have we seen this before'.",
      inputSchema: z.object({
        query: z.string().min(2).max(300),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      async execute({ query, limit }) {
        const result = await callBrainTool(binding, "search", { query, limit });
        return result.ok
          ? { results: result.content }
          : { unavailable: true, reason: result.reason };
      },
    }),
    think: tool({
      description:
        "Ask the knowledge brain a HARD question and get a synthesized answer with citations and honest gap analysis. More expensive than search — reserve for questions needing judgment across many pages ('why does the pool keep going green?', 'what do we know about this supplier?'). Not for simple lookups.",
      inputSchema: z.object({
        question: z.string().min(5).max(500),
      }),
      async execute({ question }) {
        const result = await callBrainTool(
          binding,
          "think",
          { question },
          { timeoutMs: 60_000 },
        );
        return result.ok
          ? { answer: result.content }
          : { unavailable: true, reason: result.reason };
      },
    }),
    capture: tool({
      description:
        "Record a durable observation in the property's shared brain so future conversations — yours and other bots' — benefit. Use for: confirmed recurring issues, how something was fixed, supplier/vendor behavior, decisions the team made, guest-relevant lore. SKIP ephemeral chit-chat and anything already authoritative in the app (tasks, bookings, docs). slug examples: 'systems/pool', 'suppliers/acme-pool-services', 'lore/generator'.",
      inputSchema: z.object({
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
      async execute({ slug, page_title, observation, source }) {
        const result = await captureToBrain(binding, {
          slug,
          pageTitle: page_title,
          summary: observation,
          source,
        });
        return result.ok
          ? { captured: true, slug }
          : { captured: false, reason: result.reason };
      },
    }),
  };
}
