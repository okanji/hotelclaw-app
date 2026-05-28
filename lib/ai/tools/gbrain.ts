import "server-only";
/**
 * gbrain tools, scoped per-property via the MCP connection.
 *
 * gbrain is the shared brain substrate for our two-tier AI architecture
 * (see AGENTS.md). It exposes ~30 tools via MCP — primary ones are:
 *
 *   • capture        — write an observation/signal into the brain (the
 *                      key write operation; how the brain gets smarter
 *                      over time)
 *   • search         — cheap hybrid retrieval (vector + BM25 + RRF). Use
 *                      when you need raw matches.
 *   • think          — LLM-synthesized answer with citations and gap
 *                      analysis. More expensive — reserve for harder
 *                      questions.
 *   • graph-query    — multi-hop traversal over the knowledge graph.
 *
 * Tenant isolation is at the **MCP connection / brain** layer, not in
 * tool args. `getGbrainClient(propertyId)` returns a connection scoped
 * to that property's brain; gbrain's own tools do not accept a
 * `propertyId` parameter (and rejecting unknown fields would break the
 * call). So we expose `client.tools()` as-is — schema discovery is the
 * source of truth.
 *
 * Fail-soft: if gbrain isn't reachable (env missing, no per-property
 * row, or upstream error), returns an empty tool set. Bots keep working,
 * just without gbrain.
 */
import type { ToolSet } from "ai";
import type { BotScope } from "@/lib/ai/run-bot";
import { getGbrainClient } from "@/lib/ai/mcp-clients";

/**
 * Return gbrain's MCP tool surface for the given bot's property. Empty
 * object when gbrain isn't reachable for this property.
 */
export async function buildGbrainTools(scope: BotScope): Promise<ToolSet> {
  const client = await getGbrainClient(scope.propertyId);
  if (!client) return {};

  try {
    // Schema discovery — gbrain's MCP schema is the source of truth.
    // We do not wrap or modify the tools; the connection itself is
    // already scoped to this property's brain.
    return await client.tools();
  } catch (err) {
    console.error("[gbrain] failed to load tools", err);
    return {};
  }
}
