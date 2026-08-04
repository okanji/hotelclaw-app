"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Columns2, FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatbotConfig } from "@/lib/chatbots/schema";
import { ChatMarkdown } from "./chat-markdown";
import { ChatCards } from "./chat-cards";
import { PlaygroundDialog } from "./playground-dialog";
import { ChatBubble, ThinkingRow, ToolCallList } from "./chat/primitives";

/**
 * Test console — a fake guest conversation through the REAL runtime in
 * sandbox mode (tools simulate side effects; knowledge search is live).
 * Always visible beside the editor so every change can be tried instantly.
 */

type Turn = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: unknown }[];
  attachments?: unknown;
};

export function TestConsole({
  propertyId,
  chatbotId,
  greeting,
  suggestedQuestions,
  avatarEmoji,
  dirty,
  config,
}: {
  propertyId: string;
  chatbotId: string;
  greeting: string;
  suggestedQuestions: string[];
  avatarEmoji: string;
  dirty: boolean;
  config: ChatbotConfig;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: trimmed }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/chatbots/${chatbotId}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next.map(({ role, content }) => ({ role, content })),
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        reply: string;
        toolCalls: { name: string; input: unknown }[];
        attachments?: unknown;
      };
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: data.reply,
          toolCalls: data.toolCalls,
          attachments: data.attachments,
        },
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test message failed");
      setTurns((t) => t.slice(0, -1));
      setInput(trimmed);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setTurns([]);
    await fetch(`/api/properties/${propertyId}/chatbots/${chatbotId}/test`, {
      method: "DELETE",
    }).catch(() => null);
  }

  return (
    <section className="flex h-[calc(100dvh-8rem)] max-h-[760px] flex-col rounded-lg bg-muted">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FlaskConical className="size-4" />
          Test your bot
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaygroundOpen(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Columns2 className="size-3" />
            Compare
          </button>
          <button
            type="button"
            onClick={() => void reset()}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Reset
          </button>
        </div>
      </header>

      {playgroundOpen ? (
        <PlaygroundDialog
          propertyId={propertyId}
          chatbotId={chatbotId}
          config={config}
          open={playgroundOpen}
          onOpenChange={setPlaygroundOpen}
        />
      ) : null}

      {dirty ? (
        <p className="border-b border-warning/20 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          Unsaved changes — the test runs your last saved version.
        </p>
      ) : null}

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {/* Greeting bubble mirrors what guests see first. */}
        <BotBubble emoji={avatarEmoji}>{greeting}</BotBubble>

        {turns.length === 0 && suggestedQuestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {suggestedQuestions
              .filter((q) => q.trim())
              .map((q) => (
                <Button
                  key={q}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void send(q)}
                  disabled={busy}
                  className="font-normal text-muted-foreground hover:text-foreground"
                >
                  {q}
                </Button>
              ))}
          </div>
        ) : null}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <ChatBubble side="end" tone="solid" className="max-w-[85%]">
                {t.content}
              </ChatBubble>
            </div>
          ) : (
            <div key={i} className="space-y-1">
              {t.toolCalls && t.toolCalls.length > 0 ? (
                <ToolCallList calls={t.toolCalls} />
              ) : null}
              <BotBubble emoji={avatarEmoji}>{t.content}</BotBubble>
              <div className="pl-7">
                <ChatCards
                  attachments={t.attachments}
                  onSend={busy ? undefined : (text) => void send(text)}
                />
              </div>
            </div>
          ),
        )}

        {busy ? <ThinkingRow /> : null}
      </div>

      <div className="border-t border-border p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Message as a guest…"
            rows={1}
            disabled={busy}
            className="flex-1 resize-none rounded-md bg-background px-3 py-2 text-sm max-sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:shadow-focus"
          />
          <Button
            type="button"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
          >
            Send
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Sandbox: tickets and escalations are simulated; knowledge search is
          real.
        </p>
      </div>
    </section>
  );
}

function BotBubble({
  emoji,
  children,
}: {
  emoji: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-end gap-2">
      <span className="mb-0.5 text-base" aria-hidden="true">
        {emoji}
      </span>
      <ChatBubble
        side="start"
        preWrap={false}
        className="max-w-[85%] text-foreground"
      >
        {typeof children === "string" && children ? (
          <ChatMarkdown>{children}</ChatMarkdown>
        ) : (
          children
        )}
      </ChatBubble>
    </div>
  );
}
