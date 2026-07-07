import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { trainChatbot } from "@/lib/chatbots/ingest";

// Vercel Cron — daily 04:30 UTC (see vercel.json). Auto-retrain for chatbot
// knowledge sources that point at living things:
//   • document sources whose linked doc was edited after the last training
//   • url sources trained more than 24h ago (pages drift silently)
// Text and Q&A sources only change through the builder, which already
// flips them to 'pending' — staleness can't happen there. A stale source
// retrains its whole bot (trainChatbot is per-bot), which also picks up
// any sources left sitting in 'pending'.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const URL_MAX_AGE_HOURS = 24;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const staleBots = new Map<string, string>(); // chatbot_id → property_id

  // Document sources: linked doc edited since last training.
  const { data: docSources } = await supabase
    .from("chatbot_knowledge_sources")
    .select("chatbot_id, property_id, document_id, last_trained_at")
    .eq("kind", "document")
    .not("document_id", "is", null);
  const docIds = [...new Set((docSources ?? []).map((s) => s.document_id!))];
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, body_updated_at")
      .in("id", docIds);
    const updatedAt = new Map((docs ?? []).map((d) => [d.id, d.body_updated_at]));
    for (const source of docSources ?? []) {
      const docUpdated = updatedAt.get(source.document_id!);
      if (!docUpdated) continue;
      if (!source.last_trained_at || docUpdated > source.last_trained_at) {
        staleBots.set(source.chatbot_id, source.property_id);
      }
    }
  }

  // URL sources: refresh daily.
  const urlCutoff = new Date(
    Date.now() - URL_MAX_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data: urlSources } = await supabase
    .from("chatbot_knowledge_sources")
    .select("chatbot_id, property_id, last_trained_at")
    .eq("kind", "url");
  for (const source of urlSources ?? []) {
    if (!source.last_trained_at || source.last_trained_at < urlCutoff) {
      staleBots.set(source.chatbot_id, source.property_id);
    }
  }

  const results: { chatbotId: string; status: string }[] = [];
  for (const [chatbotId, propertyId] of staleBots) {
    try {
      const result = await trainChatbot({ chatbotId, propertyId });
      results.push({
        chatbotId,
        status: `trained ${result.trained}, failed ${result.failed}, ${result.totalChunks} chunks`,
      });
    } catch (err) {
      console.error("[auto-retrain] bot failed", chatbotId, err);
      results.push({ chatbotId, status: "error" });
    }
  }

  return NextResponse.json({ retrained: results.length, results });
}
