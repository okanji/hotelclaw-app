"use client";

import { useEffect, useState } from "react";
import {
  CornerDownLeft,
  MessageCircleQuestion,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import type { WorkflowSpec } from "@/lib/workflows/spec";

// Bottom-anchored AI co-pilot for the workflow builder. v1 is non-streaming:
// user types a goal, we POST to /workflows/author, then either replace the
// spec, surface a clarification question, or surface a propose_entity_type
// confirmation.

const LOADING_PHASES = [
  "Reading your goal…",
  "Scanning available triggers and actions…",
  "Designing steps and wiring data…",
  "Validating the workflow spec…",
] as const;

export type CopilotOutcome =
  | { kind: "spec"; spec: WorkflowSpec; narration: string }
  | { kind: "clarification"; question: string; suggestions: string[]; narration: string }
  | { kind: "propose_entity_type"; entity: { name: string; display_name: string; schema: Record<string, unknown> }; narration: string }
  | { kind: "error"; message: string };

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "system"; content: string };

export function AiCopilot({
  propertyId,
  currentSpec,
  onSpec,
  onProposedEntityType,
  busy,
  setBusy,
  className,
}: {
  propertyId: string;
  currentSpec: WorkflowSpec | null;
  onSpec: (spec: WorkflowSpec) => void;
  onProposedEntityType?: (entity: {
    name: string;
    display_name: string;
    schema: Record<string, unknown>;
  }) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  className?: string;
}) {
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loadingPhase, setLoadingPhase] = useState(0);

  useEffect(() => {
    if (!busy) {
      setLoadingPhase(0);
      return;
    }
    const id = window.setInterval(() => {
      setLoadingPhase((p) => (p + 1) % LOADING_PHASES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [busy]);

  async function send(goalOverride?: string) {
    const goal = (goalOverride ?? input).trim();
    if (!goal || busy) return;
    const userTurn: Turn = { role: "user", content: goal };
    setTranscript((t) => [...t, userTurn]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/workflows/author`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          currentSpec: currentSpec ?? undefined,
          conversation: transcript.map((t) => ({
            role: t.role,
            content: t.content,
          })),
        }),
      });
      const outcome = (await res.json()) as CopilotOutcome;
      if (!res.ok && (outcome as { kind?: string }).kind !== "error") {
        throw new Error("author bot request failed");
      }

      handleOutcome(outcome);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Author failed";
      toast.error(msg);
      setTranscript((t) => [...t, { role: "system", content: msg }]);
    } finally {
      setBusy(false);
    }
  }

  function handleOutcome(outcome: CopilotOutcome) {
    switch (outcome.kind) {
      case "spec":
        onSpec(outcome.spec);
        setTranscript((t) => [
          ...t,
          { role: "assistant", content: outcome.narration || "Updated the workflow." },
        ]);
        return;
      case "clarification":
        setTranscript((t) => [
          ...t,
          {
            role: "assistant",
            content: outcome.narration || outcome.question,
          },
        ]);
        return;
      case "propose_entity_type":
        if (onProposedEntityType) onProposedEntityType(outcome.entity);
        setTranscript((t) => [
          ...t,
          {
            role: "assistant",
            content:
              outcome.narration ||
              `Proposed new entity type: ${outcome.entity.display_name}`,
          },
        ]);
        return;
      case "error":
        toast.error(outcome.message);
        setTranscript((t) => [
          ...t,
          { role: "system", content: outcome.message },
        ]);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send();
  }

  const canSubmit = !busy && input.trim().length > 0;

  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {busy ? (
        <AiCopilotLoadingPanel phase={LOADING_PHASES[loadingPhase]} />
      ) : null}

      {transcript.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-card/60 p-3">
          {transcript.map((t, i) => (
            <TranscriptRow key={i} turn={t} />
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <InputGroup
          className={cn(
            "overflow-hidden border-border/80 bg-card shadow-sm",
            busy && "opacity-80",
          )}
        >
          <InputGroupTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) void send();
              }
            }}
            placeholder={
              busy
                ? "Building your workflow…"
                : currentSpec
                  ? "Refine — e.g. ‘also wait 30 minutes before posting’"
                  : "Describe what you want — e.g. ‘when a task labeled guest-complaint is created, summarize it and assign to the manager’"
            }
            rows={2}
            disabled={busy}
            className="field-sizing-content max-h-48 min-h-16 text-[13.5px]"
          />
          <InputGroupAddon align="block-end" className="gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="size-3 text-primary" aria-hidden />
              Build with AI
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="hidden text-[10.5px] text-muted-foreground sm:inline">
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                  ⏎
                </kbd>{" "}
                to send ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                  ⇧⏎
                </kbd>{" "}
                new line
              </span>
              <InputGroupButton
                type="submit"
                disabled={!canSubmit}
                size="icon-sm"
                variant="default"
                aria-label={busy ? "Working" : "Send"}
              >
                {busy ? (
                  <Square className="size-3.5 opacity-50" aria-hidden />
                ) : (
                  <CornerDownLeft className="size-3.5" aria-hidden />
                )}
              </InputGroupButton>
            </span>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}

/** Full-width loading card — visible even on the first prompt before transcript exists. */
export function AiCopilotLoadingPanel({ phase }: { phase: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card px-4 py-3 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="size-4 text-primary animate-pulse" aria-hidden />
          <span className="absolute inset-0 rounded-full border border-primary/30 animate-ping opacity-40" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[13px] font-medium text-foreground">Building workflow with AI</p>
          <p className="text-[12px] text-muted-foreground transition-opacity duration-300">
            {phase}
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/5 animate-pulse rounded-full bg-primary/60" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TranscriptRow({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] text-foreground">
        {turn.content}
      </div>
    );
  }
  if (turn.role === "system") {
    return (
      <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
        <MessageCircleQuestion className="size-3.5 shrink-0 mt-0.5" aria-hidden />
        <span>{turn.content}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/30 px-3 py-2 text-[13px] text-foreground">
      <Sparkles className="size-3.5 shrink-0 mt-0.5 text-primary" aria-hidden />
      <span className="whitespace-pre-wrap">{turn.content}</span>
    </div>
  );
}
