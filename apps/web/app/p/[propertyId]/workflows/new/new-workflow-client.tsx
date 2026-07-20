"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  CalendarX2,
  ClipboardList,
  Headset,
  LayoutTemplate,
  LifeBuoy,
  ListTodo,
  type LucideIcon,
  Sparkles,
  TriangleAlert,
  Wand2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { TintIcon, type TintTone } from "@/components/ui/tint-card";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { classifyMode } from "@/lib/workflows/spec";
import type { Surface } from "@/lib/workflows/catalog/types";
import { TreeList } from "@/components/workflows/builder/tree-list/tree-list";
import { WorkflowBuilderDataProvider } from "@/components/workflows/builder/workflow-builder-data";
import { SurfaceLabelBadge } from "@/components/workflows/builder/surface-badge";
import { AiCopilot } from "@/components/workflows/builder/ai-copilot";

// The surfaces a workflow can read from and act on — shown as a legend under
// the hero input so it's obvious how much ground the builder covers.
const SURFACES: Surface[] = [
  "tasks",
  "chat",
  "docs",
  "meetings",
  "calendar",
  "forms",
  "bookings",
  "entities",
];

type Example = {
  icon: LucideIcon;
  title: string;
  // The plain-English goal seeded into the copilot when the card is clicked —
  // shown verbatim on the card so it's self-documenting.
  prompt: string;
  surfaces: Surface[];
};

const EXAMPLE_GROUPS: {
  label: string;
  tone: TintTone;
  examples: Example[];
}[] = [
  {
    label: "Triage & routing",
    tone: "coral",
    examples: [
      {
        icon: LifeBuoy,
        title: "Route guest complaints",
        prompt:
          "When a task labeled guest-complaint is created, summarize it and assign to the manager-on-duty",
        surfaces: ["tasks", "ai"],
      },
      {
        icon: Wand2,
        title: "Auto-triage new tasks",
        prompt:
          "When a task is created without an owner, suggest a team and assignee based on similar past tasks",
        surfaces: ["tasks", "ai"],
      },
    ],
  },
  {
    label: "Digests & reports",
    tone: "blue",
    examples: [
      {
        icon: CalendarClock,
        title: "Monday leadership digest",
        prompt:
          "Every Monday at 9am, post a digest of last week's completed tasks in #leadership",
        surfaces: ["system", "chat"],
      },
      {
        icon: TriangleAlert,
        title: "Daily blocked-work report",
        prompt:
          "Every weekday at 8am, list every blocked task with its owner in #ops",
        surfaces: ["system", "chat"],
      },
    ],
  },
  {
    label: "Follow-ups & handoffs",
    tone: "sage",
    examples: [
      {
        icon: ListTodo,
        title: "Meeting action items → tasks",
        prompt:
          "When a meeting summary is ready, create follow-up tasks for each action item and share the summary in #ops",
        surfaces: ["meetings", "tasks", "chat"],
      },
      {
        icon: ClipboardList,
        title: "Maintenance request → task",
        prompt:
          "When someone submits the maintenance-request form, create a task and notify the on-call engineer",
        surfaces: ["forms", "tasks", "chat"],
      },
    ],
  },
  {
    label: "Guest & bookings",
    tone: "honey",
    examples: [
      {
        icon: Headset,
        title: "Chatbot handoff alert",
        prompt:
          "When the guest chatbot escalates to a human, post the conversation in #front-desk and create a task",
        surfaces: ["ai", "chat", "tasks"],
      },
      {
        icon: CalendarX2,
        title: "Late cancellation alert",
        prompt:
          "When a booking is cancelled within 24 hours of its start, alert the front-desk channel",
        surfaces: ["bookings", "chat"],
      },
    ],
  },
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
      <div className="mx-auto max-w-[760px] pb-16">
        <header className="mb-6 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="size-5 text-primary" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Describe what you want
          </h1>
          <p className="mx-auto mt-2 max-w-[520px] text-sm leading-relaxed text-muted-foreground">
            Type a goal in plain English — AI designs the workflow across your
            property&apos;s tasks, chat, docs, meetings, calendar, forms,
            bookings, and entities.
          </p>
        </header>

        <AiCopilot
          propertyId={propertyId}
          currentSpec={null}
          onSpec={applyAiSpec}
          busy={busy}
          setBusy={setBusy}
          pendingPrompt={pendingPrompt}
          onPendingPromptConsumed={() => setPendingPrompt(null)}
        />

        <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
          <span className="mr-0.5 text-xs text-muted-foreground">
            Works across
          </span>
          {SURFACES.map((s) => (
            <SurfaceLabelBadge key={s} surface={s} />
          ))}
        </div>

        <div className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <Eyebrow>Start from an idea</Eyebrow>
            <Link
              href={`/p/${propertyId}/workflows/templates`}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <LayoutTemplate className="size-3.5" aria-hidden />
              Browse templates
            </Link>
          </div>

          <div className="space-y-6">
            {EXAMPLE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.examples.map((ex) => (
                    <button
                      key={ex.title}
                      type="button"
                      onClick={() => setPendingPrompt(ex.prompt)}
                      disabled={busy}
                      className={cn(
                        "group flex h-full flex-col gap-2 rounded-xl border border-border/60 bg-card p-3.5 text-left transition-colors hover:border-border hover:bg-muted/30",
                        busy && "pointer-events-none opacity-50",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <TintIcon tone={group.tone}>
                          <ex.icon aria-hidden />
                        </TintIcon>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {ex.title}
                        </span>
                        <ArrowRight
                          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {ex.prompt}
                      </p>
                      <div className="mt-auto flex flex-wrap gap-1 pt-1">
                        {ex.surfaces.map((s) => (
                          <SurfaceLabelBadge key={s} surface={s} />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
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
        <Button
          size="xs"
          onClick={create}
          disabled={creating || !name.trim()}
          className="sm:self-auto"
        >
          {creating ? "Creating…" : "Create workflow"}
        </Button>
      </header>

      {/* The inspector's pickers (channels, members) read this context; without
          it they degrade to raw-id text fields. */}
      <WorkflowBuilderDataProvider propertyId={propertyId}>
        <TreeList
          spec={spec}
          isDurable={classifyMode(spec) === "durable"}
          onChange={setSpec}
        />
      </WorkflowBuilderDataProvider>

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
