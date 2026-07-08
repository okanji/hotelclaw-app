"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  ChatbotConversationOutcome,
  ChatbotConversationStatus,
} from "@/lib/db/types";

export type ConversationListRow = {
  id: string;
  guest_name: string | null;
  room_number: string | null;
  status: ChatbotConversationStatus;
  outcome: ChatbotConversationOutcome;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
};

export function OutcomeBadge({ outcome }: { outcome: ChatbotConversationOutcome }) {
  switch (outcome) {
    case "order_placed":
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          Order placed
        </Badge>
      );
    case "booking_made":
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          Booking made
        </Badge>
      );
    case "escalated":
      return (
        <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          Escalated
        </Badge>
      );
    case "resolved":
      return <Badge variant="secondary">Resolved</Badge>;
    case "unresolved":
      return (
        <Badge className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
          Unresolved
        </Badge>
      );
    default:
      return <Badge variant="secondary">Open</Badge>;
  }
}

/**
 * Conversations tab — every web guest conversation for this bot, newest
 * first, with outcome badges. Click through to the transcript viewer
 * (which doubles as the staff reply surface for escalations).
 */
export function ConversationsTab({
  propertyId,
  chatbotId,
  conversations,
}: {
  propertyId: string;
  chatbotId: string;
  conversations: ConversationListRow[];
}) {
  if (conversations.length === 0) {
    return (
      <EmptyState icon={MessagesSquare} title="No guest conversations yet">
        Publish the bot and share its link or QR code — conversations show up
        here as guests chat.
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {conversations.map((c) => (
        <li key={c.id}>
          <Link
            href={`/p/${propertyId}/chatbots/${chatbotId}/conversations/${c.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {c.guest_name ?? "Anonymous guest"}
                {c.room_number ? (
                  <span className="text-muted-foreground"> · Room {c.room_number}</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.message_count} message{c.message_count === 1 ? "" : "s"}
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
            {c.status === "human" ? (
              <Badge className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
                With staff
              </Badge>
            ) : null}
            <OutcomeBadge outcome={c.outcome} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
