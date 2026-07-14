import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { OutcomeBadge } from "@/components/chatbots/conversations-list";
import type {
  ChatbotConversationOutcome,
  ChatbotConversationStatus,
} from "@/lib/db/types";

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
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        eyebrow="Chatbots"
        title="Conversations"
        description={
          <>
            Every guest conversation across your chatbots. Escalations are
            marked &ldquo;With staff&rdquo; — open one to reply.
          </>
        }
      />

      <hr className="my-10 border-border" />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <MessagesSquare className="size-6 text-muted-foreground" />
          </span>
          <div>
            <p className="text-sm font-medium">No conversations yet</p>
            <p className="mt-1 max-w-[40ch] text-sm text-pretty text-muted-foreground">
              Publish a chatbot and share its QR code — guest chats land here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/p/${propertyId}/chatbots/${c.chatbot_id}/conversations/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {c.guest_name ?? "Anonymous guest"}
                    {c.room_number ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · Room {c.room_number}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
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
                  </p>
                </div>
                {(c.status as ChatbotConversationStatus) === "human" ? (
                  <Badge className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
                    With staff
                  </Badge>
                ) : null}
                <OutcomeBadge outcome={c.outcome as ChatbotConversationOutcome} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
