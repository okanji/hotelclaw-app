"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/chip";
import { AGENT_TOOL_CATALOG, type AgentConfig } from "@/lib/agents/schema";
import { createAgent } from "./actions";

/**
 * Conversational "describe it" agent builder (E1 — the ClickUp flow):
 * describe the agent → the model asks one clarifying question at a time →
 * a full config draft appears for review → Create. The whole exchange is
 * sent back each turn (`/agents/generate`), so answers accumulate.
 */

type Turn = { role: "user" | "assistant"; content: string };
type Draft = { name: string; config: AgentConfig };

const EXAMPLES = [
  "A maintenance assistant that monitors open maintenance tasks and reports which are stuck and why",
  "A morning briefing agent that summarizes today's bookings and meetings for the front office",
  "A docs concierge that answers policy questions from our documents",
];

export function AgentBuilderDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  function reset() {
    setTurns([]);
    setInput("");
    setDraft(null);
  }

  function handleOpenChange(next: boolean) {
    if (busy || creating) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const nextTurns: Turn[] = [...turns, { role: "user", content }];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);
    setDraft(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/agents/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: nextTurns }),
      });
      const data = (await res.json()) as
        | { kind: "question"; question: string }
        | { kind: "draft"; name: string; config: AgentConfig }
        | { error: string };
      if ("error" in data) throw new Error(data.error);
      if (data.kind === "question") {
        setTurns([...nextTurns, { role: "assistant", content: data.question }]);
      } else {
        setDraft({ name: data.name, config: data.config });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!draft || creating) return;
    setCreating(true);
    try {
      const res = await createAgent({
        propertyId,
        name: draft.name,
        config: draft.config,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`${draft.name} created`);
      reset();
      onOpenChange(false);
      router.push(`/p/${propertyId}/agents/${res.agentId}`);
    } finally {
      setCreating(false);
    }
  }

  const toolLabel = (id: string) =>
    AGENT_TOOL_CATALOG.find((t) => t.id === id)?.label ?? id;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Describe your agent
          </DialogTitle>
          <DialogDescription>
            Say what it should do — you&rsquo;ll get a question or two, then a
            ready-to-review draft.
          </DialogDescription>
        </DialogHeader>

        {turns.length === 0 && !draft ? (
          <ul role="list" className="flex flex-col gap-1.5">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send(ex)}
                  className="w-full rounded-md bg-muted px-3 py-2 text-left text-sm leading-relaxed text-muted-foreground transition-colors hover:bg-accent"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {turns.length > 0 ? (
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            {turns.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-md px-3 py-2 text-sm leading-relaxed",
                  t.role === "user"
                    ? "self-end bg-primary/10 text-foreground"
                    : "self-start bg-muted text-foreground",
                )}
              >
                {t.content}
              </div>
            ))}
            {busy ? (
              <div className="flex items-center gap-2 self-start rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Thinking…
              </div>
            ) : null}
          </div>
        ) : null}

        {draft ? (
          <div className="flex flex-col gap-3 rounded-md bg-muted p-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl leading-none">
                {draft.config.avatarEmoji}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {draft.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {draft.config.description}
                </p>
              </div>
              <span className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs capitalize text-muted-foreground bg-muted">
                {draft.config.modelTier}
              </span>
            </div>
            {draft.config.tools.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {draft.config.tools.map((t) => (
                  <Chip key={t} size="sm" selected={false} className="pointer-events-none">
                    {toolLabel(t)}
                  </Chip>
                ))}
              </div>
            ) : null}
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Instructions preview
              </summary>
              <p className="mt-2 max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {draft.config.instructions}
              </p>
            </details>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void create()}
                disabled={creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create agent"
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                or refine below — everything stays editable afterwards
              </span>
            </div>
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-2"
        >
          <Textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              turns.length === 0
                ? "e.g. An agent that watches the maintenance list and chases stuck tasks…"
                : draft
                  ? "Want changes? Describe them…"
                  : "Your answer…"
            }
            rows={2}
            disabled={busy}
            className="min-h-0 flex-1 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
