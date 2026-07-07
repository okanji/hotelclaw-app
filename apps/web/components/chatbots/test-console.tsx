"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Columns2, FlaskConical, Loader2, RotateCcw, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatbotConfig } from "@/lib/chatbots/schema";
import { ChatMarkdown } from "./chat-markdown";
import { ChatCards } from "./chat-cards";
import { PlaygroundDialog } from "./playground-dialog";

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
    <section className="flex h-[calc(100dvh-8rem)] max-h-[760px] flex-col rounded-lg border border-border bg-muted/10">
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
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
        <p className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
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
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  disabled={busy}
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {q}
                </button>
              ))}
          </div>
        ) : null}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-background">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-1">
              {t.toolCalls && t.toolCalls.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {t.toolCalls.map((tc, j) => (
                    <span
                      key={j}
                      title={JSON.stringify(tc.input, null, 2)}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      <Wrench className="size-2.5" />
                      {tc.name}
                    </span>
                  ))}
                </div>
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

        {busy ? (
          <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Thinking…
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/60 p-2">
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
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm max-sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="h-8 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            Send
          </button>
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
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-bl-md border border-border/60 bg-background px-3 py-2",
          "text-sm leading-relaxed text-foreground",
        )}
      >
        {typeof children === "string" && children ? (
          <ChatMarkdown>{children}</ChatMarkdown>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
