import "server-only";
/**
 * Knowledge retrieval for the guest bot's `search_knowledge` tool.
 *
 * v1 is Postgres FTS (`search_chatbot_chunks` RPC, migration 0061):
 * websearch-parsed query, ts_rank ordered, scoped to one chatbot. The chunks
 * table already reserves an `embedding vector(1536)` column so hybrid
 * vector+FTS retrieval can land later without a schema change.
 */
import { createServiceClient } from "@/lib/supabase/server";
import {
  embeddingsAvailable,
  embedQuery,
  toVectorLiteral,
} from "@/lib/chatbots/embeddings";

export type KnowledgeHit = {
  content: string;
  sourceTitle: string;
  rank: number;
};

async function runSearch(
  chatbotId: string,
  query: string,
  limit: number,
): Promise<KnowledgeHit[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("search_chatbot_chunks", {
    p_chatbot_id: chatbotId,
    p_query: query,
    p_limit: limit,
  });
  if (error) {
    console.error("[chatbot-retrieval] search failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    content: row.content,
    sourceTitle: row.source_title,
    rank: row.rank,
  }));
}

async function runHybridSearch(
  chatbotId: string,
  query: string,
  embedding: number[],
  limit: number,
): Promise<KnowledgeHit[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("search_chatbot_chunks_hybrid", {
    p_chatbot_id: chatbotId,
    p_query: query,
    p_embedding: toVectorLiteral(embedding),
    p_limit: limit,
  });
  if (error) {
    console.error("[chatbot-retrieval] hybrid search failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    content: row.content,
    sourceTitle: row.source_title,
    rank: row.rank,
  }));
}

export async function searchChatbotKnowledge(args: {
  chatbotId: string;
  query: string;
  limit?: number;
}): Promise<KnowledgeHit[]> {
  const query = args.query.trim();
  if (!query) return [];
  const limit = Math.min(10, Math.max(1, args.limit ?? 6));

  // Hybrid (vector + FTS, RRF-merged) when an embeddings provider is
  // configured — semantic recall covers the paraphrase gap FTS can't.
  if (embeddingsAvailable()) {
    const embedding = await embedQuery(query);
    if (embedding) {
      const hits = await runHybridSearch(args.chatbotId, query, embedding, limit);
      if (hits.length > 0) return hits;
    }
  }

  const strict = await runSearch(args.chatbotId, query, limit);
  if (strict.length > 0) return strict;

  // Recall fallback: websearch_to_tsquery ANDs every non-stopword, so
  // "breakfast hours" misses a chunk that says "breakfast is served
  // 6:30-10:30". Re-run with the terms OR-ed (websearch understands the OR
  // keyword) — rank still floats the best chunk to the top.
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}:'-]/gu, ""))
    .filter((t) => t.length > 1);
  if (terms.length < 2) return [];
  return runSearch(args.chatbotId, terms.join(" OR "), limit);
}
