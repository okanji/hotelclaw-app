"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Pin, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { BotPanelConversation, messageText } from "@/components/ai/bot-panel-conversation";
import { cn } from "@/lib/utils";
import { scopeKey, type InsightScope } from "@/lib/insights/scope";
import { usePinPrompt } from "./pinned-prompts";

/**
 * "Ask the numbers" — the insights Q&A dock. A collapsed pill at the bottom
 * of the Insights page; expands into a small streaming chat whose answers
 * come from the same deterministic metric functions the charts render (the
 * bot cites each figure's source, and the tool calls are visible inline).
 * Stateless: `useChat` owns the transcript and posts it whole each turn with
 * the lens currently being viewed — switching the lens mid-conversation just
 * changes the default lens of the next question.
 */

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
  const [input, setInput] = useState("");
  const { pin, pinning } = usePinPrompt(propertyId, scope);

  const scopeRef = useMemo(() => ({ key: scopeKey(scope) }), [scope]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/properties/${propertyId}/insights/ask`,
        body: () => ({ scope: scopeRef.key }),
      }),
    [propertyId, scopeRef],
  );
  const { messages, sendMessage, status, stop } = useChat({
    id: `insights-ask-${propertyId}`,
    transport,
    onError: (error) => toast.error(error.message || "Couldn't reach the analyst"),
  });
  const busy = status === "submitted" || status === "streaming";

  function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    void sendMessage({ text: question });
  }

  if (!open) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-overlay bg-popover px-4 py-2 text-sm font-medium text-foreground shadow-overlay transition-colors outline-none hover:bg-accent focus-visible:shadow-focus"
        >
          <Sparkles className="size-4 text-faint-foreground" />
          Ask AI
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-overlay bg-popover shadow-overlay">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="size-4 text-faint-foreground" />
            Ask AI
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse"
            onClick={() => setOpen(false)}
            className="text-muted-foreground"
          >
            <ChevronDown className="size-4" />
          </Button>
        </div>

        <BotPanelConversation
          messages={messages}
          status={status}
          workingLabel="Reading the numbers…"
          feedback={{ propertyId, surface: "insights", sessionId: scopeRef.key }}
          className="max-h-[45vh]"
          empty={
            <div className="flex flex-col gap-2 py-1">
              <p className="text-sm text-muted-foreground">
                Answers come from the same numbers the charts use — with the
                source cited after each figure.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <Chip key={s} size="sm" onClick={() => send(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
          }
          renderAfterAssistant={(message, index) => {
            const question = messages[index - 1];
            if (!question || question.role !== "user") return null;
            return (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={pinning}
                onClick={() => void pin(messageText(question))}
                className="w-fit text-muted-foreground"
                title="Keep this question on the page — it re-answers itself when the numbers move"
              >
                <Pin className="size-3" />
                Pin this question
              </Button>
            );
          }}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
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
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about this lens's numbers…"
            disabled={busy}
            className="max-h-28 min-h-9 flex-1 resize-none rounded-md bg-transparent px-3 py-2 text-sm shadow-composer outline-none transition-[background-color,box-shadow] placeholder:text-faint-foreground focus-visible:shadow-composer-focus disabled:opacity-50 dark:bg-muted"
          />
          {busy ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void stop()}>
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              aria-label="Send"
              size="icon-lg"
              disabled={input.trim().length === 0}
              // Quiet ghost until there's something to send; then it fills in
              // (warm ink) as the clear "go" affordance.
              variant={input.trim().length > 0 ? "default" : "ghost"}
              className={cn(input.trim().length === 0 && "text-faint-foreground")}
            >
              <Send className="size-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
