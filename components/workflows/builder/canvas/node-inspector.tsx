"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Braces, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SurfaceBadge, surfaceMeta } from "@/components/workflows/builder/surface-badge";
import { getStep, getTrigger, TRIGGERS } from "@/lib/workflows/catalog";
import type { WorkflowSpec, StepNode } from "@/lib/workflows/spec";
import { TRIGGER_EVENT_TYPES } from "@/lib/workflows/spec";
import { TRIGGER_NODE_ID } from "@/lib/workflows/graph";
import { STEP_FIELDS } from "@/lib/workflows/field-defs";
import { availableRefs, type RefCandidate } from "@/lib/workflows/refs";
import { TypedStepForm } from "./typed-step-form";
import { ConditionBuilder } from "@/components/workflows/builder/config/condition-builder";
import { JsonEditor } from "@/components/workflows/builder/config/json-editor";

// Right-side non-modal panel that opens when a node is selected.
//
// Organised around the USER, not the data model:
//   • Header — surface badge + an inline-editable step NAME (not the raw id)
//   • "Reads as" — a plain-English summary of what the step does
//   • Body — a friendly typed form, or the condition builder for branch/filter
//   • "Identity & references" — the snake_case step id + {{template}} hint,
//     demoted to a collapsed section at the BOTTOM (it used to open on top)
// Autosaves to the in-memory spec; Esc / ✕ closes (no "Done" footer).

export function NodeInspector({
  spec,
  selectedNodeId,
  onClose,
  onChange,
}: {
  spec: WorkflowSpec;
  selectedNodeId: string | null;
  onClose: () => void;
  onChange: (next: WorkflowSpec) => void;
}) {
  const open = selectedNodeId !== null;
  return (
    <NonModalSidePanel open={open} onClose={onClose}>
      {selectedNodeId === TRIGGER_NODE_ID ? (
        <TriggerEditor spec={spec} onChange={onChange} />
      ) : selectedNodeId ? (
        <StepEditor spec={spec} stepId={selectedNodeId} onChange={onChange} />
      ) : null}
    </NonModalSidePanel>
  );
}

// Non-modal side panel — slides in from the right but does NOT blur or block
// the rest of the page. The user can keep clicking steps to swap which one is
// being edited. Closes via the X button, Escape, or programmatically.
function NonModalSidePanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <BaseDialog.Portal>
        <BaseDialog.Popup
          data-slot="inspector-panel"
          className={cn(
            "fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col gap-0",
            "border-l border-border bg-popover text-popover-foreground shadow-2xl",
            "transition-transform duration-200 ease-out",
            "data-starting-style:translate-x-full data-ending-style:translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="absolute top-3 right-3 z-10 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

// ─── Shared section primitives ──────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground/80">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

// ─── Trigger editor ─────────────────────────────────────────────────────────

function TriggerEditor({
  spec,
  onChange,
}: {
  spec: WorkflowSpec;
  onChange: (next: WorkflowSpec) => void;
}) {
  const meta = getTrigger(spec.trigger.event_type);
  const refs = useMemo(() => availableRefs(spec), [spec]);

  function commitEventType(next: string) {
    onChange({
      ...spec,
      trigger: { ...spec.trigger, event_type: next as typeof spec.trigger.event_type },
    });
  }

  return (
    <>
      <InspectorHeader
        surface={meta?.surface ?? "system"}
        kicker="TRIGGER"
        title={meta?.label ?? spec.trigger.event_type}
        description={meta?.description ?? "Choose what kicks this workflow off."}
      />

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <Section title="Event">
          <select
            value={spec.trigger.event_type}
            onChange={(e) => commitEventType(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {TRIGGER_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRIGGERS.find((x) => x.id === t)?.label ?? t}
              </option>
            ))}
          </select>
        </Section>

        <Section
          title="Only fire when…"
          description="Optional filter. Leave empty to fire on every event."
        >
          <ConditionBuilder
            value={spec.trigger.filter?.expr}
            refs={refs}
            onChange={(expr) => {
              onChange({
                ...spec,
                trigger: {
                  ...spec.trigger,
                  filter: expr === undefined ? undefined : { expr },
                },
              });
            }}
          />
        </Section>
      </div>
    </>
  );
}

// ─── Step editor ────────────────────────────────────────────────────────────

function StepEditor({
  spec,
  stepId,
  onChange,
}: {
  spec: WorkflowSpec;
  stepId: string;
  onChange: (next: WorkflowSpec) => void;
}) {
  const step = spec.steps[stepId];
  const meta = useMemo(() => (step ? getStep(step.type) : undefined), [step]);
  const isConditional =
    step?.type === "control.branch_if" || step?.type === "control.filter";

  const [draftId, setDraftId] = useState(stepId);
  const [label, setLabel] = useState(step?.label ?? "");

  useEffect(() => {
    setDraftId(stepId);
    setLabel(step?.label ?? "");
  }, [stepId, step]);

  const refs = useMemo(() => availableRefs(spec, stepId), [spec, stepId]);

  if (!step) return null;

  function commitLabel() {
    if (!step) return;
    onChange({
      ...spec,
      steps: { ...spec.steps, [stepId]: { ...step, label } as StepNode },
    });
  }

  function commitConfig(config: unknown) {
    if (!step) return;
    onChange({
      ...spec,
      steps: { ...spec.steps, [stepId]: { ...step, config } as StepNode },
    });
  }

  function commitRename() {
    if (!step) return;
    if (draftId === stepId || !draftId) return;
    if (spec.steps[draftId]) {
      setDraftId(stepId);
      return;
    }
    const { [stepId]: prev, ...rest } = spec.steps;
    const renamed: Record<string, StepNode> = { ...rest, [draftId]: prev };

    for (const [id, s] of Object.entries(renamed)) {
      const next: Record<string, unknown> = { ...(s as object) };
      if ((next as { next?: string }).next === stepId) next.next = draftId;
      if ((next as { on_error?: string }).on_error === `branch:${stepId}`) {
        next.on_error = `branch:${draftId}`;
      }
      if (
        "branches" in (next as object) &&
        (next as { branches?: Record<string, string> }).branches
      ) {
        const branches = { ...(next as { branches: Record<string, string> }).branches };
        for (const [k, v] of Object.entries(branches)) {
          if (v === stepId) branches[k] = draftId;
        }
        (next as { branches: Record<string, string> }).branches = branches;
      }
      renamed[id] = next as StepNode;
    }

    const layout = spec.layout ? { ...spec.layout } : undefined;
    if (layout && layout[stepId]) {
      layout[draftId] = layout[stepId];
      delete layout[stepId];
    }

    onChange({
      ...spec,
      steps: renamed,
      entry_step_id: spec.entry_step_id === stepId ? draftId : spec.entry_step_id,
      layout,
    });
  }

  const cfg = (step as { config?: unknown }).config ?? {};
  const readsAs = meta?.explain(cfg);

  return (
    <>
      <InspectorHeader
        surface={meta?.surface ?? "system"}
        kicker={
          meta?.category === "ai"
            ? "AI ACTION"
            : meta?.category === "control"
              ? "CONTROL FLOW"
              : "ACTION"
        }
        title={label}
        titlePlaceholder={meta?.label ?? step.type}
        onTitleChange={setLabel}
        onTitleCommit={commitLabel}
        description={meta?.description ?? ""}
      />

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {readsAs ? (
          <p className="rounded-md border border-border/60 bg-muted/[0.04] px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium uppercase tracking-[0.06em] text-foreground/60">
              Reads as{" "}
            </span>
            {readsAs}
          </p>
        ) : null}

        {isConditional ? (
          <Section
            title="When this is true"
            description="Compose a condition; we'll save it as JSONLogic. Switch to JSON for full power."
          >
            <ConditionBuilder
              value={(cfg as { expr?: unknown }).expr}
              refs={refs}
              onChange={(expr) => commitConfig({ ...(cfg as object), expr })}
            />
          </Section>
        ) : (
          <StepConfigSection
            stepType={step.type}
            value={cfg as Record<string, unknown>}
            onChange={commitConfig}
            refs={refs}
            explainHint={meta?.explain(cfg)}
          />
        )}

        {/* Identity & references — the snake_case + {{template}} layer lives one
         * disclosure away, not in the user's face on open. */}
        <details className="rounded-md border border-border/60 bg-muted/[0.03]">
          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[11.5px] text-muted-foreground select-none hover:text-foreground">
            <Braces className="size-3" aria-hidden />
            <span>Identity &amp; references</span>
            <code className="ml-auto font-mono text-[10.5px] text-muted-foreground/70">
              {stepId}
            </code>
          </summary>
          <div className="grid gap-2 border-t border-border/60 p-3">
            <Label className="text-[11px] text-muted-foreground">Step ID</Label>
            <Input
              value={draftId}
              onChange={(e) => setDraftId(e.target.value.replace(/[^a-z0-9_]/gi, "_"))}
              onBlur={commitRename}
              className="font-mono text-[12px]"
              placeholder="step_id"
            />
            <p className="text-[11px] text-muted-foreground">
              Reference this step in templates as{" "}
              <code className="font-mono text-muted-foreground">
                {`{{steps.${draftId}.output}}`}
              </code>
            </p>
          </div>
        </details>
      </div>
    </>
  );
}

// ─── Step config section (typed form + advanced JSON fallback) ─────────────

function StepConfigSection({
  stepType,
  value,
  onChange,
  refs,
  explainHint,
}: {
  stepType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  refs: RefCandidate[];
  explainHint?: string;
}) {
  const fields = STEP_FIELDS[stepType as keyof typeof STEP_FIELDS];
  const [showAdvanced, setShowAdvanced] = useState(false);

  const onJsonChange = (next: unknown) => {
    if (next && typeof next === "object" && !Array.isArray(next)) {
      onChange(next as Record<string, unknown>);
    } else {
      onChange({});
    }
  };

  if (!fields) {
    return (
      <Section
        title="Configuration"
        description="No friendly form yet for this step type — edit raw JSON."
      >
        <JsonEditor value={value} onChange={onJsonChange} hint={explainHint} />
      </Section>
    );
  }

  return (
    <Section title="Settings" description={explainHint}>
      <TypedStepForm fields={fields} value={value} onChange={onChange} refs={refs} />

      <details
        className="mt-3 rounded-md border border-border/60 bg-muted/[0.04]"
        open={showAdvanced}
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer items-center gap-1 px-3 py-2 text-[11.5px] text-muted-foreground select-none hover:text-foreground">
          <Braces className="size-3" />
          <span>Advanced — raw JSON</span>
        </summary>
        <div className="border-t border-border/60 p-3">
          <JsonEditor
            value={value}
            onChange={onJsonChange}
            hint="Full config object. Useful for fields the form doesn't expose."
          />
        </div>
      </details>
    </Section>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function InspectorHeader({
  surface,
  kicker,
  title,
  description,
  titlePlaceholder,
  onTitleChange,
  onTitleCommit,
}: {
  surface: ReturnType<typeof surfaceMeta>["label"] extends never
    ? never
    : Parameters<typeof SurfaceBadge>[0]["surface"];
  kicker: string;
  title: string;
  description: string;
  /** When provided, the title becomes an inline-editable name field. */
  titlePlaceholder?: string;
  onTitleChange?: (next: string) => void;
  onTitleCommit?: () => void;
}) {
  return (
    <header className="flex flex-col gap-2 border-b p-4 pr-12">
      <div className="flex items-start gap-3">
        <SurfaceBadge surface={surface} className="mt-0.5 !size-8" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {kicker}
            </span>
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {surfaceMeta(surface).label}
            </span>
          </div>
          {onTitleChange ? (
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={onTitleCommit}
              placeholder={titlePlaceholder}
              aria-label="Step name"
              className="mt-0.5 -ml-1.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[15px] font-semibold leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-border/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          ) : (
            <p className="mt-0.5 text-[15px] font-semibold leading-snug text-foreground">
              {title}
            </p>
          )}
        </div>
      </div>
      {description && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      )}
    </header>
  );
}
