"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Columns2, FlaskConical, RotateCcw } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import type { ChatbotConfig } from "@/lib/chatbots/schema";
import { ChatMarkdown } from "./chat-markdown";
import { ChatCards } from "./chat-cards";
import { PlaygroundDialog } from "./playground-dialog";
import { RetrievedKnowledge } from "./retrieved-knowledge";
import { ChatBubble, ThinkingRow, ToolCallList } from "./chat/primitives";

/**
 * Test console — a fake guest conversation through the REAL runtime in
 * sandbox mode (tools simulate side effects; knowledge search is live).
 * Always visible beside the editor so every change can be tried instantly.
 */

type Turn = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: unknown; output?: unknown }[];
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
        toolCalls: { name: string; input: unknown; output?: unknown }[];
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
    <section
      className="panel flex h-[calc(100dvh-8rem)] max-h-[760px] flex-col"
      style={{ overflow: "hidden" }}
    >
      <header className="panel-h" style={{ borderBottom: "1px solid var(--g8-border)", paddingBottom: 10 }}>
        <span className="faint" style={{ display: "inline-flex" }}>
          <Gi icon={FlaskConical} size={15} />
        </span>
        <h2>Test your bot</h2>
        <div className="acts">
          <button
            type="button"
            onClick={() => setPlaygroundOpen(true)}
            className="btn btn-ghost btn-sm"
          >
            <Gi icon={Columns2} size={13} />
            Compare
          </button>
          <button type="button" onClick={() => void reset()} className="btn btn-ghost btn-sm">
            <Gi icon={RotateCcw} size={13} />
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
        <div
          className="alert warn"
          style={{ borderRadius: 0, fontSize: 12, padding: "6px 12px" }}
        >
          Unsaved changes — the test runs your last saved version.
        </div>
      ) : null}

      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto p-3"
        style={{ background: "var(--g8-surface-2)" }}
      >
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
                  className="btn btn-secondary btn-sm"
                  style={{ fontWeight: 400 }}
                >
                  {q}
                </button>
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
            <div key={i} className="space-y-1.5">
              {t.toolCalls && t.toolCalls.length > 0 ? (
                <ToolCallList calls={t.toolCalls} />
              ) : null}
              <RetrievedKnowledge toolCalls={t.toolCalls} />
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

      <div style={{ borderTop: "1px solid var(--g8-border)", padding: 8 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
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
            aria-label="Message as a guest"
            className="textarea grow max-sm:text-base"
            style={{ resize: "none", minHeight: 36 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
          >
            Send
          </button>
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>
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
