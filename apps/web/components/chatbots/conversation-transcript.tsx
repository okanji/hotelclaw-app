"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Bot, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type {
  ChatbotConversationOutcome,
  ChatbotConversationStatus,
  ChatbotMessageRole,
} from "@/lib/db/types";
import { OutcomeBadge } from "./conversations-list";
import { ChatMarkdown } from "./chat-markdown";
import { ChatCards } from "./chat-cards";
import { sendStaffReply, setConversationState } from "./actions";
import { ChatBubble, ToolCallList } from "./chat/primitives";
import { PageShell } from "@/components/ui/page-shell";

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
    <PageShell className="flex h-full flex-col px-6 pt-8 pb-6 sm:px-10">
      <header className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Back to chatbot"
          render={<Link href={`/p/${propertyId}/chatbots/${chatbotId}`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">
            {guestLabel}
            {conversation.room_number ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · Room {conversation.room_number}
              </span>
            ) : null}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            via {botName}
            {conversation.guest_phone ? ` · ${conversation.guest_phone}` : ""}
            {conversation.guest_email ? ` · ${conversation.guest_email}` : ""}
          </p>
        </div>
        {status === "human" ? (
          <StatusBadge tone="info">With staff</StatusBadge>
        ) : null}
        <OutcomeBadge outcome={conversation.outcome} />
        {status === "human" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={returnToBot}
            disabled={flipping}
          >
            <Bot data-slot="icon" />
            Return to bot
          </Button>
        ) : null}
      </header>

      <div
        ref={listRef}
        className="mt-4 flex-1 space-y-2.5 overflow-y-auto rounded-lg bg-muted p-4"
      >
        {messages.map((m) =>
          m.role === "system" ? (
            <p
              key={m.id}
              className="mx-auto max-w-[48ch] py-1 text-center text-xs text-muted-foreground"
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
                      "mb-0.5 text-xs text-muted-foreground",
                      m.role === "guest" ? "ml-1 text-left" : "mr-1 text-right",
                    )}
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
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages yet.
          </p>
        ) : null}
      </div>

      <form onSubmit={reply} className="mt-3 flex items-end gap-2">
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
          className="flex-1 resize-none rounded-md bg-background px-3 py-2 text-sm text-foreground shadow-composer transition-[box-shadow] placeholder:text-muted-foreground focus:outline-none focus-visible:shadow-composer-focus"
        />
        <Button type="submit" disabled={sending || !input.trim()}>
          {sending ? "Sending…" : status === "human" ? "Reply" : "Take over"}
        </Button>
      </form>
      {status === "bot" ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Undo2 className="size-3" />
          Sending a reply mutes the assistant until you return the
          conversation to it.
        </p>
      ) : null}
    </PageShell>
  );
}
