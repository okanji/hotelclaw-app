"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { AiLoader } from "@/components/ui/ai-loader";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Task detail AI assistant — minimal panel inside the task detail page.
 *
 * Connects to POST /api/properties/:propertyId/tasks/:taskId/ai which runs
 * `runTaskBot()`. Conversation is held in component state and sent on
 * each turn — no server-side persistence for now (task conversations are
 * short and tightly scoped; engaged-mode-style persistence is reserved
 * for chat surfaces where multi-session context matters).
 *
 * UI: collapsed by default to stay out of the way; expands on click and
 * shows a simple input + rolling transcript of user/bot turns.
 */

type Turn = { role: "user" | "assistant"; content: string };

export function TaskAiPanel({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/tasks/${taskId}/ai`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { reply } = (await res.json()) as { reply: string };
      setTurns((t) => [...t, { role: "assistant", content: reply }]);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't reach the task assistant",
      );
      // Roll back the user turn so they can retry without duplicating it
      setTurns((t) => t.slice(0, -1));
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="mt-3 text-muted-foreground"
      >
        <Sparkles className="size-4" />
        Ask AI about this task
      </Button>
    );
  }

  return (
    <section className="mt-3 rounded-md bg-muted p-3">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="size-4" />
          Task assistant
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </header>

      {turns.length > 0 ? (
        <div className="mb-3 space-y-2 max-h-72 overflow-y-auto pr-1">
          {turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                "rounded-md px-3 py-2 text-sm leading-5 whitespace-pre-wrap",
                t.role === "user"
                  ? "bg-card text-foreground shadow-ring"
                  : "bg-foreground/[0.04] text-foreground",
              )}
            >
              {t.content}
            </div>
          ))}
          {busy ? (
            <div className="px-3 py-2">
              <AiLoader label="Thinking…" />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <Textarea
          name="task-ai-question"
          aria-label="Ask the task assistant"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="What does this task involve? Who's blocked on this? Suggest next steps…"
          rows={2}
          className="min-h-0 flex-1 resize-none bg-background shadow-composer focus-visible:shadow-composer-focus"
          disabled={busy}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "Ask"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-faint-foreground">
        Answers come from a Claude-backed assistant with access to this task,
        its sub-tasks, and related tasks. Powered by the Hotelclaw bot runtime.
      </p>
    </section>
  );
}
