import { createClient } from "@/lib/supabase/server";
import { ChatbotsList, type ChatbotListItem } from "@/components/chatbots/chatbots-list";

/**
 * Chatbots index — every guest-facing bot in the property (RLS scopes the
 * tenant; the layout already gated membership). Today's message counts come
 * from chatbot_usage_daily so the cap meters match the budget enforcement.
 */
export default async function ChatbotsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();

  const { data: chatbots } = await supabase
    .from("chatbots")
    .select(
      "id, name, public_slug, template, config, status, daily_message_cap, session_message_cap, last_trained_at, created_at, updated_at",
    )
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRows } = await supabase
    .from("chatbot_usage_daily")
    .select("chatbot_id, messages")
    .eq("property_id", propertyId)
    .eq("day", today);

  const usageToday: Record<string, number> = {};
  for (const row of usageRows ?? []) {
    usageToday[row.chatbot_id] = row.messages;
  }

  return (
    <ChatbotsList
      propertyId={propertyId}
      chatbots={(chatbots ?? []) as ChatbotListItem[]}
      usageToday={usageToday}
    />
  );
}
