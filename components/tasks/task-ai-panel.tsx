"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/15 px-3 py-1.5 text-[13px] text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
      >
        <Sparkles className="size-4" />
        Ask AI about this task
      </button>
    );
  }

  return (
    <section className="mt-3 rounded-lg border border-border/60 bg-muted/10 p-3">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Sparkles className="size-4" />
          Task assistant
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-muted-foreground hover:text-foreground"
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
                "rounded-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                t.role === "user"
                  ? "bg-background border border-border/60 text-foreground"
                  : "bg-foreground/[0.04] text-foreground",
              )}
            >
              {t.content}
            </div>
          ))}
          {busy ? (
            <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Thinking…
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
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
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={busy}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background disabled:opacity-50"
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Answers come from a Claude-backed assistant with access to this task,
        its sub-tasks, and related tasks. Powered by the Hotelclaw bot runtime.
      </p>
    </section>
  );
}
