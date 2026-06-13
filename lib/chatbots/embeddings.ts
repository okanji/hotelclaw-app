import "server-only";
/**
 * Embeddings for chatbot knowledge — fail-soft like gbrain/OpenClaw config:
 * when OPENAI_API_KEY is unset every function returns null, training skips
 * the embedding pass, and retrieval stays FTS-only. Set the key and retrain
 * to light up hybrid (vector + FTS) retrieval — the schema has carried the
 * `embedding vector(1536)` column since migration 0061.
 *
 * Model: text-embedding-3-small (1536 dims — must match the column).
 */
import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

const MODEL = "text-embedding-3-small";

function provider() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({ apiKey });
}

export function embeddingsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const openai = provider();
  if (!openai) return null;
  try {
    const { embedding } = await embed({
      model: openai.textEmbeddingModel(MODEL),
      value: text,
    });
    return embedding;
  } catch (err) {
    console.error("[chatbot-embeddings] query embed failed", err);
    return null;
  }
}

/** Batch-embed chunk texts. Returns null (not partial data) on any failure. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const openai = provider();
  if (!openai || texts.length === 0) return null;
  try {
    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(MODEL),
      values: texts,
      maxRetries: 2,
    });
    return embeddings;
  } catch (err) {
    console.error("[chatbot-embeddings] batch embed failed", err);
    return null;
  }
}

/** pgvector text form for PostgREST params/inserts. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
