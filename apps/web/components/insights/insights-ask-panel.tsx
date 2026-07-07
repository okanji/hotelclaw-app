"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, Loader2, Pin, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scopeKey, type InsightScope } from "@/lib/insights/scope";
import { usePinPrompt } from "./pinned-prompts";

/**
 * "Ask the numbers" — the insights Q&A dock. A collapsed pill at the bottom
 * of the Insights page; expands into a small chat whose answers come from
 * the same deterministic metric functions the charts render (the bot cites
 * each figure's source). Stateless: the transcript lives in component state
 * and is posted whole each turn with the lens currently being viewed —
 * switching the lens mid-conversation just changes the default lens of the
 * next question (earlier answers stay valid; they cite their own lens).
 */

type Turn = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What's overdue this week?",
  "Why did cycle time move?",
  "Which projects are at risk?",
];

export function InsightsAskPanel({
  propertyId,
  scope,
}: {
  propertyId: string;
  scope: InsightScope;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pin, pinning } = usePinPrompt(propertyId, scope);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/insights/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, scope: scopeKey(scope) }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { reply } = (await res.json()) as { reply: string };
      setTurns((t) => [...t, { role: "assistant", content: reply }]);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't reach the analyst",
      );
      setTurns((t) => t.slice(0, -1));
      setInput(question);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 text-sm font-medium text-foreground ring-1 ring-foreground/10 shadow-lg backdrop-blur hover:bg-muted dark:shadow-none"
        >
          <Sparkles className="size-4" />
          Ask AI
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-background/95 ring-1 ring-foreground/10 shadow-xl backdrop-blur dark:shadow-none">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="size-4" />
            Ask AI
          </span>
          <button
            type="button"
            aria-label="Collapse"
            onClick={() => setOpen(false)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto px-4 py-3"
        >
          {turns.length === 0 ? (
            <div className="flex flex-col gap-2 py-1">
              <p className="text-sm text-muted-foreground">
                Answers come from the same numbers the charts use — with the
                source cited after each figure.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t, i) =>
              t.role === "user" ? (
                <p
                  key={i}
                  className="ml-8 self-end rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground"
                >
                  {t.content}
                </p>
              ) : (
                <div key={i} className="flex flex-col gap-1">
                  <div
                    className={cn(
                      "prose prose-sm dark:prose-invert max-w-none",
                      "text-sm leading-relaxed text-foreground [&_li]:my-0.5 [&_p]:my-1",
                    )}
                  >
                    <ReactMarkdown>{t.content}</ReactMarkdown>
                  </div>
                  {turns[i - 1]?.role === "user" ? (
                    <button
                      type="button"
                      disabled={pinning}
                      onClick={() => void pin(turns[i - 1].content)}
                      className="flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Keep this question on the page — it re-answers itself when the numbers move"
                    >
                      <Pin className="size-3" />
                      Pin this question
                    </button>
                  ) : null}
                </div>
              ),
            )
          )}
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Reading the numbers…
            </p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-end gap-2 border-t border-border px-3 py-2.5"
        >
          <textarea
            name="question"
            aria-label="Ask about the numbers"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask about this lens's numbers…"
            disabled={busy}
            className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || input.trim().length === 0}
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
