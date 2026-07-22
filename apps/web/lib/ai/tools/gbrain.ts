import "server-only";
/**
 * Shared-brain tools for Tier-1 bots — a CURATED surface over the shared
 * gbrain server (fleet v2), not raw MCP schema discovery. The serve
 * exposes ~100 ops; bots get the read ladder + one disciplined write:
 *
 *   • brain_search — cheap hybrid retrieval (works even before embeddings)
 *   • brain_get    — full page by slug (search returns chunks)
 *   • brain_list   — enumeration (slug-prefix filter, newest first)
 *   • brain_think  — LLM-synthesized answer with citations + gap analysis
 *   • brain_capture— append durable evidence to an entity page's timeline
 *
 * Descriptions/schemas come from @hotelclaw/brain — the SAME words the eve
 * runtime uses, so the surfaces can't drift. Tenant isolation lives in the
 * OAuth CLIENT the property resolves to (write-source binding +
 * federated-read allow-list enforced by the serve) — never in tool args.
 * Fail-soft: unresolved binding ⇒ empty tool set, bots run brainless.
 */
import { tool, type ToolSet } from "ai";
import {
  brainToolDescriptions,
  brainToolSchemas,
  normalizeListPages,
} from "@hotelclaw/brain";
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
    brain_search: tool({
      description: brainToolDescriptions.brain_search,
      inputSchema: brainToolSchemas.brain_search,
      async execute({ query, limit }) {
        const result = await callBrainTool(binding, "search", { query, limit });
        return result.ok
          ? { results: result.content }
          : { unavailable: true, reason: result.reason };
      },
    }),
    brain_think: tool({
      description: brainToolDescriptions.brain_think,
      inputSchema: brainToolSchemas.brain_think,
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
    brain_get: tool({
      description: brainToolDescriptions.brain_get,
      inputSchema: brainToolSchemas.brain_get,
      async execute({ slug }) {
        const result = await callBrainTool(binding, "get_page", { slug });
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
    brain_list: tool({
      description: brainToolDescriptions.brain_list,
      inputSchema: brainToolSchemas.brain_list,
      async execute({ prefix, limit }) {
        const result = await callBrainTool(binding, "list_pages", {
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
    brain_capture: tool({
      description: brainToolDescriptions.brain_capture,
      inputSchema: brainToolSchemas.brain_capture,
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
