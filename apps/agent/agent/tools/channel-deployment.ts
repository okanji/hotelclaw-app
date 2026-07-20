import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { serviceClient } from "../lib/supabase";
import { CHANNEL_BOT_SLUG, resolveSessionAgent } from "../lib/agent-config";
import {
  customToolName,
  executeCustomAction,
  type CustomActionRow,
} from "../lib/custom-actions";

// Deployment tools for CHANNEL-BOT sessions serving a custom chatbot
// (chatbot_channel_deployments — resolved in agent-config.ts off the
// x-hotelclaw-channel attribute). Mirrors the web guest-side builders
// (apps/web/lib/ai/guest-bot/tools/registry.ts buildChannelDeploymentTools
// and lib/chatbots/retrieval.ts searchChatbotKnowledge — keep behavior in
// sync): the bot's knowledge search + its custom_<slug> HTTP actions.
// Brain tools and render_ui mount from their own resolvers; property tools
// come from the catalog grants. eve constraint: execute INLINE.

type KnowledgeHit = { content: string; sourceTitle: string; rank: number };

async function runSearch(
  chatbotId: string,
  query: string,
  limit: number,
): Promise<KnowledgeHit[]> {
  const { data, error } = await serviceClient().rpc("search_chatbot_chunks", {
    p_chatbot_id: chatbotId,
    p_query: query,
    p_limit: limit,
  });
  if (error) {
    console.error("[channel-deployment] search failed", error.message);
    return [];
  }
  return ((data ?? []) as { content: string; source_title: string; rank: number }[]).map(
    (row) => ({ content: row.content, sourceTitle: row.source_title, rank: row.rank }),
  );
}

/** Query embedding via the OpenAI REST API directly — apps/agent deliberately
 * has no @ai-sdk/openai (ai v7 pairing risk); the model/dims mirror
 * apps/web/lib/chatbots/embeddings.ts. Null on any failure (fail-soft to FTS). */
async function embedQuery(query: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { embedding?: number[] }[] };
    const embedding = body.data?.[0]?.embedding;
    return Array.isArray(embedding) && embedding.length > 0 ? embedding : null;
  } catch {
    return null;
  }
}

/** Port of searchChatbotKnowledge: hybrid when embeddings resolve, else
 * strict FTS, else the OR-recall fallback (websearch_to_tsquery ANDs). */
async function searchKnowledge(
  chatbotId: string,
  rawQuery: string,
  limitArg?: number,
): Promise<KnowledgeHit[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const limit = Math.min(10, Math.max(1, limitArg ?? 6));

  const embedding = await embedQuery(query);
  if (embedding) {
    const { data, error } = await serviceClient().rpc("search_chatbot_chunks_hybrid", {
      p_chatbot_id: chatbotId,
      p_query: query,
      p_embedding: `[${embedding.join(",")}]`,
      p_limit: limit,
    });
    if (!error) {
      const hits = ((data ?? []) as { content: string; source_title: string; rank: number }[]).map(
        (row) => ({ content: row.content, sourceTitle: row.source_title, rank: row.rank }),
      );
      if (hits.length > 0) return hits;
    } else {
      console.error("[channel-deployment] hybrid search failed", error.message);
    }
  }

  const strict = await runSearch(chatbotId, query, limit);
  if (strict.length > 0) return strict;

  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}:'-]/gu, ""))
    .filter((t) => t.length > 1);
  if (terms.length < 2) return [];
  return runSearch(chatbotId, terms.join(" OR "), limit);
}

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const botSlug = ctx.session.auth.current?.attributes?.botSlug;
      const agentId = ctx.session.auth.current?.attributes?.agentId;
      if (typeof agentId === "string" || botSlug !== CHANNEL_BOT_SLUG) return null;

      const resolved = await resolveSessionAgent(
        ctx as unknown as Parameters<typeof resolveSessionAgent>[0],
      );
      const deployment = resolved?.deployment;
      if (!deployment) return null;
      const chatbotId = deployment.chatbotId;
      const chatbotName = deployment.chatbotName;

      const tools: Record<string, ReturnType<typeof defineTool>> = {
        search_knowledge: defineTool({
          description: `Search the "${chatbotName}" bot's trained knowledge base — menus, policies, hours, FAQs the team curated for it.`,
          inputSchema: z.object({
            query: z.string().describe("Search terms, rephrased as keywords"),
          }),
          async execute({ query }) {
            const hits = await searchKnowledge(chatbotId, query);
            if (hits.length === 0) {
              return { results: [], note: "No matches in the knowledge base." };
            }
            return {
              results: hits.map((h) => ({ source: h.sourceTitle, content: h.content })),
            };
          },
        }),
      };

      const { data: actionRows } = await serviceClient()
        .from("chatbot_custom_actions")
        .select("*")
        .eq("chatbot_id", chatbotId)
        .eq("enabled", true);

      const taken = new Set(Object.keys(tools));
      for (const raw of (actionRows ?? []) as CustomActionRow[]) {
        const name = customToolName(raw.name, taken);
        taken.add(name);
        const row = raw;
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const field of row.param_schema) {
          let t: z.ZodTypeAny =
            field.type === "number"
              ? z.number()
              : field.type === "boolean"
                ? z.boolean()
                : z.string();
          if (field.description) t = t.describe(field.description);
          shape[field.name] = field.required ? t : t.optional();
        }
        tools[name] = defineTool({
          description: row.when_to_use
            ? `Call the property's "${row.name}" integration.\nWhen to use: ${row.when_to_use}`
            : `Call the property's "${row.name}" integration.`,
          inputSchema: z.object(shape),
          async execute(params) {
            const result = await executeCustomAction(
              row,
              params as Record<string, unknown>,
            );
            if (!result.ok) {
              return {
                ok: false,
                error: result.error,
                note: "The integration call failed — apologize briefly and offer the team instead. Do not retry more than once.",
              };
            }
            return { ok: true, status: result.status, data: result.data };
          },
        });
      }

      return tools;
    },
  },
});
