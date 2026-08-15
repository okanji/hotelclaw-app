"use client";

import { useEffect, useRef, useState } from "react";
import {
  CornerDownLeft,
  MessageCircleQuestion,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import type { WorkflowSpec } from "@/lib/workflows/spec";

// Bottom-anchored AI co-pilot for the workflow builder. v1 is non-streaming:
// user types a goal, we POST to /workflows/author, then either replace the
// spec, surface a clarification question, or surface a propose_entity_type
// confirmation.

const LOADING_PHASES = [
  "Reading your request…",
  "Finding the right starting point…",
  "Building the steps…",
  "Double-checking everything…",
] as const;

type ProposedEntity = { name: string; display_name: string; schema: Record<string, unknown> };

export type CopilotOutcome =
  | { kind: "spec"; spec: WorkflowSpec; narration: string }
  | { kind: "clarification"; question: string; suggestions: string[]; narration: string }
  | { kind: "propose_entity_type"; entity: ProposedEntity; narration: string }
  | { kind: "error"; message: string };

type Turn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      suggestions?: string[];
      // When set, the row renders a "Create this entity type" action. Creating
      // it (via /entities/types) then resumes `resumeGoal` so the bot can finish
      // the workflow it was blocked on — closing what was a hard dead-end.
      entityProposal?: ProposedEntity & { resumeGoal: string };
    }
  | { role: "system"; content: string };

export function AiCopilot({
  propertyId,
  currentSpec,
  onSpec,
  onProposedEntityType,
  busy,
  setBusy,
  className,
  pendingPrompt,
  onPendingPromptConsumed,
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
  // A goal pushed in from outside (starter prompt, cross-surface ?prefill).
  // Sent through the same conversational path as typed input — so clarifications
  // and entity proposals are answerable, not swallowed into a toast.
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
}) {
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [creatingEntity, setCreatingEntity] = useState<string | null>(null);

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

  // Consume an externally-pushed prompt exactly once, routing it through the
  // normal send() path.
  //
  // The latch is a ref, NOT the `busy` flag or the parent's clear callback:
  // both of those take effect on the NEXT render, so React's StrictMode
  // double-invoke (and any re-render racing the state update) re-entered this
  // effect with `pendingPrompt` still set and `busy` still false — firing two
  // identical author-bot turns and printing the goal twice in the transcript.
  // A ref flips synchronously, so the second invoke bails.
  const consumedPrompt = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingPrompt || busy) return;
    if (consumedPrompt.current === pendingPrompt) return;
    consumedPrompt.current = pendingPrompt;
    onPendingPromptConsumed?.();
    void send(pendingPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, busy]);

  async function send(goalOverride?: string, opts?: { pushUser?: boolean }) {
    const goal = (goalOverride ?? input).trim();
    if (!goal || busy) return;
    if (opts?.pushUser !== false) {
      const userTurn: Turn = { role: "user", content: goal };
      setTranscript((t) => [...t, userTurn]);
    }
    if (!goalOverride) setInput("");
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

      handleOutcome(outcome, goal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Author failed";
      toast.error(msg);
      setTranscript((t) => [...t, { role: "system", content: msg }]);
    } finally {
      setBusy(false);
    }
  }

  function handleOutcome(outcome: CopilotOutcome, goal: string) {
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
            suggestions: outcome.suggestions,
          },
        ]);
        return;
      case "propose_entity_type":
        // Notify the parent if it cares, but DON'T depend on it — the inline
        // action below is the actual recovery path so this is never a dead-end.
        onProposedEntityType?.(outcome.entity);
        setTranscript((t) => [
          ...t,
          {
            role: "assistant",
            content:
              outcome.narration ||
              `This needs a “${outcome.entity.display_name}” record type, which doesn't exist yet.`,
            entityProposal: { ...outcome.entity, resumeGoal: goal },
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

  async function createEntityType(proposal: ProposedEntity & { resumeGoal: string }) {
    if (creatingEntity || busy) return;
    setCreatingEntity(proposal.name);
    try {
      const res = await fetch(`/api/properties/${propertyId}/entities/types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: proposal.name,
          display_name: proposal.display_name,
          schema: proposal.schema,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Created “${proposal.display_name}”`);
      // Drop the action from the proposal turn so it can't be created twice,
      // then resume the original goal — the bot can now build the workflow.
      setTranscript((t) =>
        t.map((turn) =>
          turn.role === "assistant" && turn.entityProposal?.name === proposal.name
            ? { ...turn, entityProposal: undefined, content: `Created “${proposal.display_name}”. Continuing…` }
            : turn,
        ),
      );
      void send(proposal.resumeGoal, { pushUser: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the record type");
    } finally {
      setCreatingEntity(null);
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
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-md bg-muted p-3">
          {transcript.map((t, i) => (
            <TranscriptRow
              key={i}
              turn={t}
              // Only the latest assistant turn's suggestions stay actionable.
              onPickSuggestion={
                !busy && i === transcript.length - 1 ? (s) => void send(s) : undefined
              }
              onCreateEntity={createEntityType}
              creatingEntity={creatingEntity}
              actionsDisabled={busy}
            />
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <InputGroup
          className={cn(
            "overflow-hidden bg-card shadow-composer has-[[data-slot=input-group-control]:focus-visible]:shadow-composer-focus",
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
                  ? "Make a change — e.g. ‘also wait 30 minutes before posting’"
                  : "Describe what you want — e.g. ‘when a task labeled guest-complaint is created, summarize it and assign to the manager’"
            }
            rows={2}
            disabled={busy}
            className="field-sizing-content max-h-48 min-h-16 text-sm"
          />
          <InputGroupAddon align="block-end" className="gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3 text-primary-ink" aria-hidden />
              Build with AI
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                <Kbd>⏎</Kbd> to send · <Kbd>⇧⏎</Kbd> new line
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
      className="rounded-md bg-muted px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="size-4 text-primary-ink animate-pulse" aria-hidden />
          <span className="absolute inset-0 animate-ping rounded-full ring-1 ring-primary/30 opacity-40" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-foreground">Building workflow with AI</p>
          <p className="text-xs text-muted-foreground transition-opacity duration-300">
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

function TranscriptRow({
  turn,
  onPickSuggestion,
  onCreateEntity,
  creatingEntity,
  actionsDisabled,
}: {
  turn: Turn;
  onPickSuggestion?: (suggestion: string) => void;
  onCreateEntity?: (proposal: ProposedEntity & { resumeGoal: string }) => void;
  creatingEntity?: string | null;
  actionsDisabled?: boolean;
}) {
  if (turn.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-md bg-background px-3 py-2 text-sm text-foreground">
        {turn.content}
      </div>
    );
  }
  if (turn.role === "system") {
    return (
      <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <MessageCircleQuestion className="size-3.5 shrink-0 mt-0.5" aria-hidden />
        <span>{turn.content}</span>
      </div>
    );
  }
  return (
    <div className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
      <div className="flex items-start gap-2">
        <Sparkles className="size-3.5 shrink-0 mt-0.5 text-primary-ink" aria-hidden />
        <span className="whitespace-pre-wrap">{turn.content}</span>
      </div>
      {turn.suggestions && turn.suggestions.length > 0 && onPickSuggestion ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          {turn.suggestions.map((s) => (
            <Chip
              key={s}
              size="sm"
              onClick={() => onPickSuggestion(s)}
              className="bg-background font-medium text-foreground hover:bg-accent"
            >
              {s}
            </Chip>
          ))}
        </div>
      ) : null}
      {turn.entityProposal && onCreateEntity ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          <button
            type="button"
            disabled={actionsDisabled || creatingEntity === turn.entityProposal.name}
            onClick={() => onCreateEntity(turn.entityProposal!)}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className="size-3" aria-hidden />
            {creatingEntity === turn.entityProposal.name
              ? "Creating…"
              : `Create “${turn.entityProposal.display_name}” record type`}
          </button>
          <span className="text-xs text-muted-foreground">then I’ll finish the workflow</span>
        </div>
      ) : null}
    </div>
  );
}
