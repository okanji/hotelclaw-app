"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Headset,
  LayoutTemplate,
  LifeBuoy,
  ListTodo,
  type LucideIcon,
  TriangleAlert,
  Wand2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Gi } from "@/components/gr8r/icon";
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
  /** gr8r palette token for the group's icon tiles. */
  tone: string;
  examples: Example[];
}[] = [
  {
    label: "Triage & routing",
    tone: "var(--g8-orange)",
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
    tone: "var(--g8-blue)",
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
    tone: "var(--g8-green)",
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
    label: "Guests",
    tone: "var(--g8-amber)",
    examples: [
      {
        icon: Headset,
        title: "Chatbot handoff alert",
        prompt:
          "When the guest chatbot escalates to a human, post the conversation in #front-desk and create a task",
        surfaces: ["ai", "chat", "tasks"],
      },
    ],
  },
];

// Decode the base64 ?prefill= JSON and pull out its `goal` string, if any.
// The payload is UTF-8 bytes base64'd (see lib/workflows/features.ts), so we
// decode the bytes rather than treating them as Latin-1 — otherwise a goal
// carrying an en dash or an accented name arrives mojibake'd. ASCII payloads
// (every ?prefill= link written before that encoder existed) are unaffected.
function decodePrefillGoal(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { goal?: unknown };
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

  // Manual path (AI stays the primary flow): open the tree builder on a
  // minimal one-step skeleton the user edits directly. The empty channel_id
  // is deliberate — the create API validates the spec, so an untouched
  // skeleton can't be saved by accident.
  function startFromScratch() {
    setSpec({
      workflow_spec_version: 1,
      name: "Untitled workflow",
      trigger: { event_type: "task.created" },
      entry_step_id: "step_1",
      steps: {
        step_1: {
          id: "step_1",
          type: "action.chat.post_message",
          config: {
            channel_id: "",
            text: "New task: {{trigger.task.title}}",
          },
        },
      },
      metadata: { last_edited_by: "human" },
    } as WorkflowSpec);
    if (!name) setName("Untitled workflow");
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
      <div style={{ paddingBottom: 48 }}>
        <AiCopilot
          propertyId={propertyId}
          currentSpec={null}
          onSpec={applyAiSpec}
          busy={busy}
          setBusy={setBusy}
          pendingPrompt={pendingPrompt}
          onPendingPromptConsumed={() => setPendingPrompt(null)}
        />

        <div className="row" style={{ marginTop: 16, flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
          <span className="faint" style={{ fontSize: 12 }}>
            Works across
          </span>
          {SURFACES.map((s) => (
            <SurfaceLabelBadge key={s} surface={s} />
          ))}
        </div>

        <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button
            type="button"
            onClick={startFromScratch}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >
            <Gi icon={Workflow} size={14} />
            Or build it by hand — start from scratch
          </button>
        </div>

        <div style={{ marginTop: 36 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="eyebrow">Start from an idea</span>
            <span className="sp" />
            <Link
              href={`/p/${propertyId}/workflows/templates`}
              className="btn btn-ghost btn-sm"
            >
              <Gi icon={LayoutTemplate} size={14} />
              Browse templates
            </Link>
          </div>

          <div className="stack" style={{ gap: 20 }}>
            {EXAMPLE_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="label" style={{ marginBottom: 8, color: "var(--g8-text-2)" }}>
                  {group.label}
                </div>
                <div className="pgrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                  {group.examples.map((ex) => (
                    <button
                      key={ex.title}
                      type="button"
                      onClick={() => setPendingPrompt(ex.prompt)}
                      disabled={busy}
                      className="pcard"
                      style={{ gap: 8, opacity: busy ? 0.5 : undefined }}
                    >
                      <span className="row" style={{ gap: 10, width: "100%" }}>
                        <span className="picon" style={{ "--g8-c": group.tone } as CSSProperties}>
                          <Gi icon={ex.icon} size={15} />
                        </span>
                        <span className="trunc grow" style={{ fontWeight: 600 }}>
                          {ex.title}
                        </span>
                        <span className="faint">
                          <Gi icon={ArrowRight} size={14} />
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
                        {ex.prompt}
                      </span>
                      <span className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: "auto" }}>
                        {ex.surfaces.map((s) => (
                          <SurfaceLabelBadge key={s} surface={s} />
                        ))}
                      </span>
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
    <div>
      <header className="row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <div className="row grow" style={{ gap: 8 }}>
          <span className="faint">
            <Gi icon={Workflow} size={15} />
          </span>
          <input
            type="text"
            value={name}
            aria-label="Workflow name"
            onChange={(e) => setName(e.target.value)}
            className="input grow"
            style={{ fontWeight: 600 }}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={create}
          disabled={creating || !name.trim()}
        >
          {creating ? "Creating…" : "Create workflow"}
        </button>
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

      <div style={{ marginTop: 16 }}>
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
