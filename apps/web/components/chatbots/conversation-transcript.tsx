"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Gi } from "@/components/gr8r/icon";
import { cn } from "@/lib/utils";
import type {
  ChatbotConversationOutcome,
  ChatbotConversationStatus,
  ChatbotMessageRole,
} from "@/lib/db/types";
import { OutcomeBadge, WithStaffBadge } from "./conversations-list";
import { ChatMarkdown } from "./chat-markdown";
import { ChatCards } from "./chat-cards";
import { sendStaffReply, setConversationState } from "./actions";
import { ChatBubble, ToolCallList } from "./chat/primitives";
import { PageHeader } from "@/components/shell/page-header";

export type TranscriptMessage = {
  id: string;
  role: ChatbotMessageRole;
  content: string;
  tool_calls: { name: string; input: unknown }[] | null;
  attachments?: unknown;
  feedback?: number | null;
  created_at: string;
};

type Conversation = {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  room_number: string | null;
  status: ChatbotConversationStatus;
  outcome: ChatbotConversationOutcome;
  created_at: string;
};

/**
 * Live transcript + staff reply surface. Realtime on chatbot_messages
 * (INSERT) and the conversation row (status flips) so a guest's messages
 * appear as they type — replies the guest picks up via their poll.
 */
export function ConversationTranscript({
  propertyId,
  chatbotId,
  botName,
  conversation,
  initialMessages,
}: {
  propertyId: string;
  chatbotId: string;
  botName: string;
  conversation: Conversation;
  initialMessages: TranscriptMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(conversation.status);
  const [input, setInput] = useState("");
  const [sending, startSending] = useTransition();
  const [flipping, startFlipping] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chatbot-convo:${conversation.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chatbot_messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const row = payload.new as TranscriptMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chatbot_conversations",
          filter: `id=eq.${conversation.id}`,
        },
        (payload) => {
          const row = payload.new as { status?: ChatbotConversationStatus };
          if (row.status) setStatus(row.status);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversation.id]);

  function reply(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    startSending(async () => {
      const result = await sendStaffReply({ conversationId: conversation.id, text });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setInput("");
      setStatus("human");
      // Realtime echoes the inserted row back into the list.
    });
  }

  function returnToBot() {
    startFlipping(async () => {
      const result = await setConversationState({
        conversationId: conversation.id,
        state: "bot",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStatus("bot");
      toast.success("The assistant has the conversation again");
      router.refresh();
    });
  }

  const guestLabel = conversation.guest_name ?? "Anonymous guest";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Chatbots", href: `/p/${propertyId}/chatbots`, icon: <Bot /> },
          { label: botName, href: `/p/${propertyId}/chatbots/${chatbotId}` },
          {
            label: conversation.room_number
              ? `${guestLabel} · Room ${conversation.room_number}`
              : guestLabel,
          },
        ]}
      />
      <div className="page flex min-h-0 w-full flex-1 flex-col" style={{ paddingBottom: 24 }}>
        <div className="ph">
          <div style={{ minWidth: 0 }}>
            <h1>
              {conversation.room_number
                ? `${guestLabel} · Room ${conversation.room_number}`
                : guestLabel}
            </h1>
            <p className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {status === "human" ? <WithStaffBadge /> : null}
              <OutcomeBadge outcome={conversation.outcome} />
              <span className="muted">
                {[botName, conversation.guest_phone, conversation.guest_email]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
          </div>
          {status === "human" ? (
            <div className="acts">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={returnToBot}
                disabled={flipping}
              >
                <Gi icon={Bot} size={14} />
                Return to bot
              </button>
            </div>
          ) : null}
        </div>

        <div
          ref={listRef}
          className="panel flex-1 space-y-2.5 overflow-y-auto p-4"
          style={{ background: "var(--g8-surface-2)" }}
        >
          {messages.map((m) =>
            m.role === "system" ? (
              <p
                key={m.id}
                className="faint mx-auto max-w-[48ch] py-1 text-center"
                style={{ fontSize: 12 }}
              >
                {m.content}
              </p>
            ) : (
              <div key={m.id} className="space-y-1">
                {/* Tool outputs aren't persisted on this surface — chips
                    expand to show the call's input only. */}
                {m.tool_calls && m.tool_calls.length > 0 ? (
                  <ToolCallList calls={m.tool_calls} />
                ) : null}
                <div
                  className={cn(
                    "flex",
                    m.role === "guest" ? "justify-start" : "justify-end",
                  )}
                >
                  <div className="max-w-[80%]">
                    <p
                      className={cn(
                        "faint mb-0.5",
                        m.role === "guest" ? "ml-1 text-left" : "mr-1 text-right",
                      )}
                      style={{ fontSize: 12 }}
                    >
                      {m.role === "guest"
                        ? guestLabel
                        : m.role === "staff"
                          ? "Staff"
                          : botName}
                      {" · "}
                      {new Date(m.created_at).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {m.feedback === 1 ? " · 👍" : m.feedback === -1 ? " · 👎" : ""}
                    </p>
                    <ChatBubble
                      side={m.role === "guest" ? "start" : "end"}
                      tone={
                        m.role === "guest"
                          ? "outline"
                          : m.role === "staff"
                            ? "staff"
                            : "soft"
                      }
                      preWrap={m.role !== "bot"}
                    >
                      {m.role === "bot" && m.content ? (
                        <ChatMarkdown>{m.content}</ChatMarkdown>
                      ) : (
                        m.content
                      )}
                    </ChatBubble>
                    {m.role === "bot" ? (
                      <ChatCards attachments={m.attachments} />
                    ) : null}
                  </div>
                </div>
              </div>
            ),
          )}
          {messages.length === 0 ? (
            <div className="empty-state sm">
              <p>No messages yet.</p>
            </div>
          ) : null}
        </div>

        <form onSubmit={reply} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
            placeholder={
              status === "human"
                ? `Reply to ${guestLabel} — they see it on their chat page`
                : "Type to take over from the assistant…"
            }
            rows={2}
            disabled={sending}
            aria-label="Reply to the guest"
            className="textarea grow"
            style={{ resize: "none" }}
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
            {sending ? "Sending…" : status === "human" ? "Reply" : "Take over"}
          </button>
        </form>
        {status === "bot" ? (
          <p className="hint row" style={{ margin: "6px 0 0", gap: 5 }}>
            <Gi icon={Undo2} size={12} />
            Sending a reply mutes the assistant until you return the
            conversation to it.
          </p>
        ) : null}
      </div>
    </div>
  );
}
