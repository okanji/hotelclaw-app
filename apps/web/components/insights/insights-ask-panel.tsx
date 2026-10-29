"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Pin, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { BotPanelConversation, messageText } from "@/components/ai/bot-panel-conversation";
import { Gi } from "@/components/gr8r/icon";
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
          className="btn btn-secondary pointer-events-auto"
          style={{ boxShadow: "var(--g8-shadow-pop)", borderRadius: "var(--g8-r-full)" }}
        >
          <Gi icon={Sparkles} size={14} />
          Ask AI
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div
        className="panel pointer-events-auto flex w-full max-w-2xl flex-col overflow-hidden"
        style={{ boxShadow: "var(--g8-shadow-pop)" }}
      >
        <div className="panel-h" style={{ borderBottom: "1px solid var(--g8-border)", paddingBottom: 12 }}>
          <Gi icon={Sparkles} size={14} />
          <h2>Ask AI</h2>
          <div className="acts">
            <button
              type="button"
              className="ibtn ibtn-sm"
              aria-label="Collapse"
              onClick={() => setOpen(false)}
            >
              <Gi icon={ChevronDown} size={14} />
            </button>
          </div>
        </div>

        <BotPanelConversation
          messages={messages}
          status={status}
          workingLabel="Reading the numbers…"
          feedback={{ propertyId, surface: "insights", sessionId: scopeRef.key }}
          className="max-h-[45vh]"
          empty={
            <div className="flex flex-col gap-2 py-1">
              <p className="muted" style={{ margin: 0, fontSize: "var(--g8-fs-sm)" }}>
                Answers come from the same numbers the charts use — with the
                source cited after each figure.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          }
          renderAfterAssistant={(message, index) => {
            const question = messages[index - 1];
            if (!question || question.role !== "user") return null;
            return (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: "fit-content" }}
                disabled={pinning}
                onClick={() => void pin(messageText(question))}
                title="Keep this question on the page — it re-answers itself when the numbers move"
              >
                <Gi icon={Pin} size={12} />
                Pin this question
              </button>
            );
          }}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 px-3 py-2.5"
          style={{ borderTop: "1px solid var(--g8-border)" }}
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
            className="textarea max-h-28 flex-1 resize-none"
            style={{ minHeight: 34 }}
          />
          {busy ? (
            <button type="button" className="btn btn-secondary" onClick={() => void stop()}>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={input.trim().length === 0}
              // Quiet until there's something to send; then it fills in as
              // the clear "go" affordance.
              className={input.trim().length > 0 ? "btn btn-primary" : "btn btn-ghost"}
            >
              <Gi icon={Send} size={14} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
