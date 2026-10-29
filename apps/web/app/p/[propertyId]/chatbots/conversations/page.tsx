import Link from "next/link";
import { Bot, MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Gi } from "@/components/gr8r/icon";
import { OutcomeBadge, WithStaffBadge } from "@/components/chatbots/conversations-list";
import type {
  ChatbotConversationOutcome,
  ChatbotConversationStatus,
} from "@/lib/db/types";
import { PageHeader } from "@/components/shell/page-header";

/**
 * Property-wide guest-conversation inbox — every bot, newest first, with
 * escalations ("With staff") surfaced by badge. Static segment, so it wins
 * over the [chatbotId] dynamic route.
 */
export default async function AllConversationsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();

  const [{ data: conversations }, { data: bots }] = await Promise.all([
    supabase
      .from("chatbot_conversations")
      .select(
        "id, chatbot_id, guest_name, room_number, status, outcome, message_count, last_message_at",
      )
      .eq("property_id", propertyId)
      .eq("channel", "web")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase.from("chatbots").select("id, name").eq("property_id", propertyId),
  ]);

  const botNames = new Map((bots ?? []).map((b) => [b.id, b.name]));
  const rows = conversations ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Chatbots", href: `/p/${propertyId}/chatbots`, icon: <Bot /> },
          { label: "Conversations" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph">
            <div>
              <h1>Conversations</h1>
              <p>Every guest chat across your bots. Escalations show “With staff” — open one to reply.</p>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={MessagesSquare} />
                </div>
                <p className="es-h">No conversations yet</p>
                <p>Publish a chatbot and share its QR code — guest chats land here.</p>
              </div>
            </div>
          ) : (
            <ul className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/p/${propertyId}/chatbots/${c.chatbot_id}/conversations/${c.id}`}
                    className="nrow"
                    style={{ alignItems: "center" }}
                  >
                    <div className="col grow" style={{ gap: 2 }}>
                      <span className="trunc" style={{ fontWeight: 500 }}>
                        {c.guest_name ?? "Anonymous guest"}
                        {c.room_number ? (
                          <span className="muted"> · Room {c.room_number}</span>
                        ) : null}
                      </span>
                      <span className="trunc muted" style={{ fontSize: 12 }}>
                        {botNames.get(c.chatbot_id) ?? "Chatbot"} · {c.message_count}{" "}
                        message{c.message_count === 1 ? "" : "s"}
                        {c.last_message_at
                          ? ` · ${new Date(c.last_message_at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}`
                          : ""}
                      </span>
                    </div>
                    {(c.status as ChatbotConversationStatus) === "human" ? <WithStaffBadge /> : null}
                    <OutcomeBadge outcome={c.outcome as ChatbotConversationOutcome} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
