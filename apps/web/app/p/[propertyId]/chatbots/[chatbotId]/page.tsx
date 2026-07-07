import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatbotDetail } from "@/components/chatbots/chatbot-detail";
import type { CustomActionListItem } from "@/components/chatbots/custom-actions-panel";
import type { ChatbotRow } from "@/lib/chatbots/schema";

/**
 * Chatbot builder — editor tabs + live test console. Everything the client
 * needs for its pickers (channels for notify targets, spaces for tickets,
 * members for assignees) is fetched here under RLS.
 */
export default async function ChatbotDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string; chatbotId: string }>;
}) {
  const { propertyId, chatbotId } = await params;
  const supabase = await createClient();

  const { data: bot } = await supabase
    .from("chatbots")
    .select("*")
    .eq("id", chatbotId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!bot) notFound();

  const [
    { data: sources },
    { data: channels },
    { data: spaces },
    { data: conversations },
    { data: documents },
  ] = await Promise.all([
      supabase
        .from("chatbot_knowledge_sources")
        .select(
          "id, kind, title, content, question, document_id, url, status, error, char_count, last_trained_at, created_at",
        )
        .eq("chatbot_id", chatbotId)
        .order("created_at", { ascending: false }),
      supabase
        .from("chat_channels")
        .select("id, name, stream_channel_id")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("spaces")
        .select("id, name")
        .eq("property_id", propertyId)
        .order("name"),
      supabase
        .from("chatbot_conversations")
        .select(
          "id, guest_name, room_number, status, outcome, message_count, last_message_at, created_at",
        )
        .eq("chatbot_id", chatbotId)
        .eq("channel", "web")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100),
      supabase
        .from("documents")
        .select("id, title")
        .eq("property_id", propertyId)
        .eq("kind", "doc")
        .is("archived_at", null)
        .order("title")
        .limit(200),
    ]);

  const [{ data: deployments }, { data: services }] = await Promise.all([
    supabase
      .from("chatbot_channel_deployments")
      .select("stream_channel_id")
      .eq("chatbot_id", chatbotId),
    supabase
      .from("bookable_services")
      .select("id, name, emoji, active")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("name"),
  ]);

  // Custom actions — header SECRETS stay server-side; the client only sees
  // header names (rendered as "•••• saved" in the editor).
  const { data: customActionRows } = await supabase
    .from("chatbot_custom_actions")
    .select(
      "id, name, when_to_use, method, url, headers, body_template, param_schema, response_allowlist, enabled",
    )
    .eq("chatbot_id", chatbotId)
    .order("created_at");
  const customActions: CustomActionListItem[] = (customActionRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    when_to_use: row.when_to_use,
    method: row.method,
    url: row.url,
    headerNames: (row.headers ?? []).map((h) => h.name),
    body_template: row.body_template,
    param_schema: row.param_schema,
    response_allowlist: row.response_allowlist,
    enabled: row.enabled,
  }));

  return (
    <ChatbotDetail
      propertyId={propertyId}
      bot={bot as unknown as ChatbotRow}
      sources={sources ?? []}
      channels={channels ?? []}
      spaces={spaces ?? []}
      conversations={conversations ?? []}
      documents={documents ?? []}
      customActions={customActions}
      deployedChannelIds={(deployments ?? []).map((d) => d.stream_channel_id)}
      services={services ?? []}
    />
  );
}
