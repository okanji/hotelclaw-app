"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Document AI assistant — popover-anchored chat panel inside the editor
 * header. Connects to POST /api/properties/:propertyId/documents/:documentId/ai
 * which runs `runDocBot()`.
 *
 * Why a popover (not inline like the task panel): the doc editor takes
 * the full page height. An inline expand-in-place would shove editor
 * content down. A popover keeps the editor surface untouched while
 * still giving a real conversation surface.
 *
 * Conversation lives in component state and is re-sent each turn — no
 * server-side persistence (doc conversations are short and per-session).
 */

type Turn = { role: "user" | "assistant"; content: string };

export function DocumentAiPanel({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
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
        `/api/properties/${propertyId}/documents/${documentId}/ai`,
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
        e instanceof Error ? e.message : "Couldn't reach the doc assistant",
      );
      // Roll back the user turn so they can retry without duplicating it.
      setTurns((t) => t.slice(0, -1));
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/15 px-2.5 py-1 text-[12px] text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          >
            <Sparkles className="size-3.5" />
            Ask AI
          </button>
        )}
      />
      <PopoverContent
        align="end"
        sideOffset={8}
        className="!w-[380px] !max-w-[calc(100vw-2rem)] !p-3"
      >
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <Sparkles className="size-4" />
            Document assistant
          </div>
        </header>

        {turns.length > 0 ? (
          <div className="mb-3 max-h-72 space-y-2 overflow-y-auto pr-1">
            {turns.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                  t.role === "user"
                    ? "border border-border/60 bg-background text-foreground"
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
            placeholder="Summarize this doc. What are the action items? What's the team discussing?"
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
          Answers come from Claude with access to this document and its
          comment threads.
        </p>
      </PopoverContent>
    </Popover>
  );
}
