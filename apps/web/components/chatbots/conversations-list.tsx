"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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
  /** Haiku-labeled (0063), classified lazily by the Analytics tab loader —
   *  null until that classification pass has covered this conversation. */
  topic?: string | null;
  sentiment?: "positive" | "neutral" | "negative" | null;
};

/** gr8r `.badge` with its dot (a dot-less gray badge for settled states). */
function G8Badge({
  tone,
  dot = true,
  children,
}: {
  tone: "green" | "amber" | "red" | "accent" | "gray";
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge ${tone}`}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

/** A conversation outcome is a LIFECYCLE state → a gr8r `.badge`. */
export function OutcomeBadge({ outcome }: { outcome: ChatbotConversationOutcome }) {
  switch (outcome) {
    case "order_placed":
      return <G8Badge tone="green">Order placed</G8Badge>;
    case "booking_made":
      // Historical rows only — the booking action was removed 2026-10-29.
      return <G8Badge tone="green">Booking made</G8Badge>;
    case "escalated":
      return <G8Badge tone="amber">Escalated</G8Badge>;
    case "resolved":
      return (
        <G8Badge tone="gray" dot={false}>
          Resolved
        </G8Badge>
      );
    case "unresolved":
      return <G8Badge tone="red">Unresolved</G8Badge>;
    default:
      return (
        <G8Badge tone="gray" dot={false}>
          Open
        </G8Badge>
      );
  }
}

/** "With staff" — the conversation is taken over by a person. */
export function WithStaffBadge() {
  return <G8Badge tone="accent">With staff</G8Badge>;
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
      <div className="panel">
        <div className="empty-state">
          <div className="glyph">
            <Gi icon={MessagesSquare} />
          </div>
          <p className="es-h">No guest conversations yet</p>
          <p>
            Publish the bot and share its link or QR code — conversations show up
            here as guests chat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {conversations.map((c) => (
        <li key={c.id}>
          <Link
            href={`/p/${propertyId}/chatbots/${chatbotId}/conversations/${c.id}`}
            className="nrow"
            style={{ alignItems: "center" }}
          >
            <ConversationLine c={c} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One conversation row's body: guest · room, meta line, sentiment, badges. */
function ConversationLine({ c }: { c: ConversationListRow }) {
  return (
    <>
      <div className="col grow" style={{ gap: 2 }}>
        <span className="trunc" style={{ fontWeight: 500 }}>
          {c.guest_name ?? "Anonymous guest"}
          {c.room_number ? <span className="muted"> · Room {c.room_number}</span> : null}
        </span>
        <span className="trunc muted" style={{ fontSize: 12 }}>
          {c.message_count} message{c.message_count === 1 ? "" : "s"}
          {c.last_message_at
            ? ` · ${new Date(c.last_message_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : ""}
          {c.topic ? ` · ${c.topic}` : ""}
        </span>
      </div>
      {/* AI-labeled columns (records-grid pattern): the Haiku topic +
          sentiment already cached on the row by the Analytics pass —
          surfaced here so the list is scannable without opening each
          transcript. Unclassified rows simply omit them. */}
      {c.sentiment ? (
        <span
          aria-label={`Sentiment: ${c.sentiment}`}
          title={`Sentiment: ${c.sentiment}`}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            background:
              c.sentiment === "positive"
                ? "var(--g8-green)"
                : c.sentiment === "negative"
                  ? "var(--g8-red)"
                  : "var(--g8-border-strong)",
          }}
        />
      ) : null}
      {c.status === "human" ? <WithStaffBadge /> : null}
      <OutcomeBadge outcome={c.outcome} />
    </>
  );
}
