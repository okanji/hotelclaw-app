import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ConversationTranscript,
  type TranscriptMessage,
} from "@/components/chatbots/conversation-transcript";

/**
 * Staff view of one guest conversation — the transcript inspector and,
 * for escalations, the reply surface (escalation notifications and Stream
 * cards deep-link here). Live via Supabase Realtime on the client.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{
    propertyId: string;
    chatbotId: string;
    conversationId: string;
  }>;
}) {
  const { propertyId, chatbotId, conversationId } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("chatbot_conversations")
    .select(
      "id, chatbot_id, guest_name, guest_email, guest_phone, room_number, status, outcome, created_at",
    )
    .eq("id", conversationId)
    .eq("chatbot_id", chatbotId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!conversation) notFound();

  const [{ data: bot }, { data: messages }] = await Promise.all([
    supabase
      .from("chatbots")
      .select("name, config")
      .eq("id", chatbotId)
      .maybeSingle(),
    supabase
      .from("chatbot_messages")
      .select("id, role, content, tool_calls, attachments, feedback, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  return (
    <ConversationTranscript
      propertyId={propertyId}
      chatbotId={chatbotId}
      botName={bot?.name ?? "Chatbot"}
      conversation={conversation}
      initialMessages={(messages ?? []) as TranscriptMessage[]}
    />
  );
}
