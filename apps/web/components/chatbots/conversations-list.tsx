"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
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

/**
 * A conversation outcome is a LIFECYCLE state, so it renders as the house
 * StatusBadge (4px pill, hue-at-16% fill, same-hue ink) rather than a Badge
 * with hand-mixed `/10` fills and a `border-*` class that painted nothing —
 * there was no border width beside it.
 */
export function OutcomeBadge({ outcome }: { outcome: ChatbotConversationOutcome }) {
  switch (outcome) {
    case "order_placed":
      return <StatusBadge tone="success">Order placed</StatusBadge>;
    case "booking_made":
      return <StatusBadge tone="success">Booking made</StatusBadge>;
    case "escalated":
      return <StatusBadge tone="warning">Escalated</StatusBadge>;
    case "resolved":
      return (
        <StatusBadge tone="neutral" dot={false}>
          Resolved
        </StatusBadge>
      );
    case "unresolved":
      return <StatusBadge tone="danger">Unresolved</StatusBadge>;
    default:
      return (
        <StatusBadge tone="neutral" dot={false}>
          Open
        </StatusBadge>
      );
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
    <ul className="divide-y divide-border">
      {conversations.map((c) => (
        <li key={c.id}>
          <Link
            href={`/p/${propertyId}/chatbots/${chatbotId}/conversations/${c.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
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
              <StatusBadge tone="info">With staff</StatusBadge>
            ) : null}
            <OutcomeBadge outcome={c.outcome} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
