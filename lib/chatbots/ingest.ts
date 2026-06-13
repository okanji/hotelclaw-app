import "server-only";
/**
 * Knowledge ingestion ("training"): turn a bot's sources into retrieval
 * chunks. Runs from the train route — fast enough to run inline for typical
 * source sizes (chunking is pure string work; no model calls in v1).
 *
 * Source kinds:
 *   text     — chunk `content` directly
 *   qa       — one chunk per pair: "Q: …\nA: …" (exact-answer overrides)
 *   document — snapshot the in-app document's live `body_text` at train time
 *   url      — fetch the page server-side, strip tags, chunk the text
 */
import { createServiceClient } from "@/lib/supabase/server";
import { embedTexts, toVectorLiteral } from "@/lib/chatbots/embeddings";

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_SOURCE = 400;

/** Paragraph-first chunker: split on blank lines, repack to ~CHUNK_SIZE,
 *  hard-split oversized paragraphs with overlap so no content is dropped. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_SIZE) {
      flush();
      for (let i = 0; i < para.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(para.slice(i, i + CHUNK_SIZE).trim());
      }
      continue;
    }
    if (current.length + para.length + 2 > CHUNK_SIZE) flush();
    current += (current ? "\n\n" : "") + para;
  }
  flush();

  return chunks.filter(Boolean).slice(0, MAX_CHUNKS_PER_SOURCE);
}

/** Crude but dependency-free HTML → text for url sources. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** SSRF guard for staff-pasted URLs — the fetch runs server-side. */
function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]"
  ) {
    return false;
  }
  return true;
}

async function fetchUrlText(url: string): Promise<string> {
  if (!isFetchableUrl(url)) throw new Error("That URL can't be fetched");
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "hotelclaw-chatbot-trainer/1.0" },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const body = await res.text();
  // Cap raw input so one giant page can't blow up the chunk table.
  return htmlToText(body.slice(0, 600_000));
}

export type TrainResult = {
  trained: number;
  failed: number;
  totalChunks: number;
};

/**
 * (Re)train every source of a chatbot: rebuild content where the source is
 * a pointer (document/url), wipe the source's old chunks, insert fresh ones.
 * Per-source failures are recorded on the row and don't abort the rest.
 */
export async function trainChatbot(args: {
  chatbotId: string;
  propertyId: string;
}): Promise<TrainResult> {
  const supabase = createServiceClient();
  const { data: sources, error } = await supabase
    .from("chatbot_knowledge_sources")
    .select("id, kind, title, content, question, document_id, url")
    .eq("chatbot_id", args.chatbotId)
    .eq("property_id", args.propertyId);
  if (error) throw new Error(error.message);

  let trained = 0;
  let failed = 0;
  let totalChunks = 0;
  const now = new Date().toISOString();

  for (const source of sources ?? []) {
    try {
      let text = "";
      if (source.kind === "text") {
        text = source.content ?? "";
      } else if (source.kind === "qa") {
        text = `Q: ${source.question ?? ""}\nA: ${source.content ?? ""}`;
      } else if (source.kind === "document") {
        if (!source.document_id) throw new Error("No document linked");
        const { data: doc } = await supabase
          .from("documents")
          .select("title, body_text")
          .eq("id", source.document_id)
          .eq("property_id", args.propertyId)
          .maybeSingle();
        if (!doc) throw new Error("Linked document not found");
        text = `${doc.title}\n\n${doc.body_text ?? ""}`;
        // Snapshot so the Knowledge tab shows what the bot actually knows.
        await supabase
          .from("chatbot_knowledge_sources")
          .update({ content: text })
          .eq("id", source.id);
      } else if (source.kind === "url") {
        if (!source.url) throw new Error("No URL set");
        text = await fetchUrlText(source.url);
        await supabase
          .from("chatbot_knowledge_sources")
          .update({ content: text })
          .eq("id", source.id);
      }

      const chunks = chunkText(text);
      await supabase
        .from("chatbot_knowledge_chunks")
        .delete()
        .eq("source_id", source.id);
      if (chunks.length > 0) {
        // Embeddings are fail-soft: null (no key / API hiccup) trains
        // FTS-only and hybrid retrieval simply doesn't engage.
        const embeddings = await embedTexts(chunks);
        const { error: insErr } = await supabase
          .from("chatbot_knowledge_chunks")
          .insert(
            chunks.map((content, i) => ({
              source_id: source.id,
              chatbot_id: args.chatbotId,
              property_id: args.propertyId,
              content,
              embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
            })),
          );
        if (insErr) throw new Error(insErr.message);
      }

      await supabase
        .from("chatbot_knowledge_sources")
        .update({
          status: "trained",
          error: null,
          char_count: text.length,
          last_trained_at: now,
        })
        .eq("id", source.id);
      trained += 1;
      totalChunks += chunks.length;
    } catch (err) {
      failed += 1;
      await supabase
        .from("chatbot_knowledge_sources")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message : "Training failed",
        })
        .eq("id", source.id);
    }
  }

  await supabase
    .from("chatbots")
    .update({ last_trained_at: now })
    .eq("id", args.chatbotId);

  return { trained, failed, totalChunks };
}
