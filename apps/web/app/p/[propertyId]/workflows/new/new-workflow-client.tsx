"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { classifyMode } from "@/lib/workflows/spec";
import { TreeList } from "@/components/workflows/builder/tree-list/tree-list";
import { AiCopilot } from "@/components/workflows/builder/ai-copilot";

const STARTER_PROMPTS = [
  "When a task labeled guest-complaint is created, summarize it and assign to the manager-on-duty",
  "Every Monday at 9am, post a digest of last week's completed tasks in #leadership",
  "When a meeting summary is ready, create follow-up tasks for each action item and share the summary in #ops",
];

// Decode the base64 ?prefill= JSON and pull out its `goal` string, if any.
function decodePrefillGoal(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw)) as { goal?: unknown };
    return typeof parsed.goal === "string" ? parsed.goal : null;
  } catch {
    return null;
  }
}

export function NewWorkflowClient({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [spec, setSpec] = useState<WorkflowSpec | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  // Cross-surface entry points (kanban column overflow, task menu, chat menu)
  // pass a base64-encoded prefill JSON in ?prefill=. We extract its `goal` once,
  // up front, and hand it to the copilot as the first turn (via pendingPrompt)
  // so any clarification / entity proposal it triggers stays answerable instead
  // of vanishing into a toast. Seeding state directly (rather than in an effect)
  // avoids a cascading re-render on mount.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(() =>
    decodePrefillGoal(searchParams.get("prefill")),
  );

  function applyAiSpec(next: WorkflowSpec) {
    setSpec(next);
    if (!name) setName(next.name);
  }

  async function create() {
    if (!spec || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || spec.name,
          description: spec.description,
          spec,
          enabled: false,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      toast.success("Workflow created — turn it on when you're ready.");
      router.push(`/p/${propertyId}/workflows/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  if (!spec) {
    return (
      <div className="mx-auto max-w-[640px]">
        <header className="mb-6 text-center">
          <Sparkles className="mx-auto mb-3 size-7 text-primary" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Describe what you want
          </h1>
          <p className="mx-auto mt-2 max-w-[480px] text-sm leading-relaxed text-muted-foreground">
            Type a goal in plain English — AI will design the workflow on your
            property&apos;s tasks, chat, docs, meetings, calendar, and entities.
          </p>
        </header>

        <div className="mb-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Try one of these
          </p>
          <ul className="flex flex-col gap-1.5">
            {STARTER_PROMPTS.map((p, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setPendingPrompt(p)}
                  className={cn(
                    "w-full rounded-md border border-border/60 bg-card px-3 py-2 text-left text-xs text-foreground hover:bg-muted/40",
                    busy && "opacity-50",
                  )}
                  disabled={busy}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <AiCopilot
          propertyId={propertyId}
          currentSpec={null}
          onSpec={applyAiSpec}
          busy={busy}
          setBusy={setBusy}
          pendingPrompt={pendingPrompt}
          onPendingPromptConsumed={() => setPendingPrompt(null)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[820px]">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Workflow className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-foreground hover:border-border/60 focus:border-border focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={create}
          disabled={creating || !name.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50 sm:self-auto"
        >
          {creating ? "Creating…" : "Create workflow"}
        </button>
      </header>

      <TreeList
        spec={spec}
        isDurable={classifyMode(spec) === "durable"}
        onChange={setSpec}
      />

      <div className="mt-4">
        <AiCopilot
          propertyId={propertyId}
          currentSpec={spec}
          onSpec={applyAiSpec}
          busy={busy}
          setBusy={setBusy}
        />
      </div>
    </div>
  );
}
