import "server-only";
/**
 * Chatbot analytics — the house "deterministic numbers, model labels"
 * split. Counts/volumes/outcomes come straight from SQL; Haiku only names
 * the topic and reads the sentiment of each conversation, ONCE, cached on
 * the row (`topic`/`sentiment`, migration 0063). Classification runs
 * lazily when the Analytics tab loads: settled, unlabeled conversations
 * are batched into a single Haiku call (≤25 per load), so a quiet bot
 * costs nothing.
 */
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";
const BATCH_LIMIT = 25;
/** Don't classify a conversation that might still be going. */
const SETTLE_MINUTES = 10;

const Classification = z.object({
  conversations: z.array(
    z.object({
      id: z.string(),
      /** 2-4 word theme, e.g. "breakfast hours", "room service order". */
      topic: z.string().min(1).max(60),
      sentiment: z.enum(["positive", "neutral", "negative"]),
    }),
  ),
});

/** Label settled, unlabeled conversations. Fail-soft: errors just leave
 *  rows unlabeled for the next load. Returns how many got labeled. */
export async function classifyConversations(args: {
  chatbotId: string;
  propertyId: string;
}): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const supabase = createServiceClient();
  const settledBefore = new Date(
    Date.now() - SETTLE_MINUTES * 60 * 1000,
  ).toISOString();

  const { data: pending } = await supabase
    .from("chatbot_conversations")
    .select("id")
    .eq("chatbot_id", args.chatbotId)
    .eq("channel", "web")
    .is("topic", null)
    .gte("message_count", 2)
    .lt("last_message_at", settledBefore)
    .order("last_message_at", { ascending: false })
    .limit(BATCH_LIMIT);
  if (!pending || pending.length === 0) return 0;

  // First ~8 turns of each conversation are plenty for a topic label.
  const transcripts: { id: string; text: string }[] = [];
  for (const convo of pending) {
    const { data: messages } = await supabase
      .from("chatbot_messages")
      .select("role, content")
      .eq("conversation_id", convo.id)
      .in("role", ["guest", "bot"])
      .order("created_at", { ascending: true })
      .limit(8);
    const text = (messages ?? [])
      .map((m) => `${m.role === "guest" ? "Guest" : "Bot"}: ${m.content.slice(0, 300)}`)
      .join("\n");
    if (text) transcripts.push({ id: convo.id, text });
  }
  if (transcripts.length === 0) return 0;

  let labeled: z.infer<typeof Classification>;
  try {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await generateText({
      model: anthropic(CLASSIFY_MODEL),
      output: Output.object({ schema: Classification }),
      temperature: 0,
      maxRetries: 2,
      system: [
        "You label guest-chatbot conversations for a hotel analytics dashboard.",
        "For each conversation, return its id, a short topic (2-4 lowercase words naming what the guest wanted, e.g. 'breakfast hours', 'room service order', 'late checkout request', 'complaint about noise'), and the GUEST's overall sentiment.",
        "Reuse identical topic strings for conversations about the same thing — these are aggregated into counts.",
        "Sentiment: 'negative' only when the guest is dissatisfied or frustrated; ordering food happily is 'positive'; plain Q&A is 'neutral'.",
      ].join("\n"),
      prompt: transcripts
        .map((t) => `=== Conversation ${t.id} ===\n${t.text}`)
        .join("\n\n"),
    });
    labeled = result.output;
  } catch (err) {
    console.error("[chatbot-analytics] classification failed", err);
    return 0;
  }

  const validIds = new Set(transcripts.map((t) => t.id));
  let updated = 0;
  for (const row of labeled.conversations) {
    if (!validIds.has(row.id)) continue; // model-invented id — drop
    const { error } = await supabase
      .from("chatbot_conversations")
      .update({
        topic: row.topic.toLowerCase().trim().slice(0, 60),
        sentiment: row.sentiment,
      })
      .eq("id", row.id)
      .eq("chatbot_id", args.chatbotId);
    if (!error) updated += 1;
  }
  return updated;
}

export type ChatbotAnalytics = {
  totals: {
    conversations: number;
    messages: number;
    ordersPlaced: number;
    escalated: number;
    thumbsUp: number;
    thumbsDown: number;
  };
  topics: {
    topic: string;
    count: number;
    sentiment: { positive: number; neutral: number; negative: number };
  }[];
  sentiment: { positive: number; neutral: number; negative: number };
  /** Last 14 days of bot replies, oldest first. */
  volume: { day: string; messages: number }[];
};

export async function getChatbotAnalytics(args: {
  chatbotId: string;
  propertyId: string;
}): Promise<ChatbotAnalytics> {
  const supabase = createServiceClient();

  const { data: convos } = await supabase
    .from("chatbot_conversations")
    .select("id, outcome, topic, sentiment")
    .eq("chatbot_id", args.chatbotId)
    .eq("channel", "web");
  const rows = convos ?? [];
  const convoIds = rows.map((c) => c.id);

  const messageCount = (filter: { feedback?: 1 | -1 }) => {
    let q = supabase
      .from("chatbot_messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", convoIds.length > 0 ? convoIds : ["00000000-0000-0000-0000-000000000000"]);
    if (filter.feedback) q = q.eq("feedback", filter.feedback);
    return q;
  };

  const [{ data: usage }, thumbsUp, thumbsDown, msgCount] = await Promise.all([
    supabase
      .from("chatbot_usage_daily")
      .select("day, messages")
      .eq("chatbot_id", args.chatbotId)
      .gte("day", new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10))
      .order("day"),
    messageCount({ feedback: 1 }),
    messageCount({ feedback: -1 }),
    messageCount({}),
  ]);
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  const topicMap = new Map<string, ChatbotAnalytics["topics"][number]>();
  let ordersPlaced = 0;
  let escalated = 0;
  for (const c of rows) {
    if (c.outcome === "order_placed") ordersPlaced += 1;
    if (c.outcome === "escalated") escalated += 1;
    if (c.sentiment) sentiment[c.sentiment] += 1;
    if (c.topic) {
      const entry =
        topicMap.get(c.topic) ?? {
          topic: c.topic,
          count: 0,
          sentiment: { positive: 0, neutral: 0, negative: 0 },
        };
      entry.count += 1;
      if (c.sentiment) entry.sentiment[c.sentiment] += 1;
      topicMap.set(c.topic, entry);
    }
  }

  return {
    totals: {
      conversations: rows.length,
      messages: msgCount.count ?? 0,
      ordersPlaced,
      escalated,
      thumbsUp: thumbsUp.count ?? 0,
      thumbsDown: thumbsDown.count ?? 0,
    },
    topics: [...topicMap.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    sentiment,
    volume: (usage ?? []).map((u) => ({ day: u.day, messages: u.messages })),
  };
}
