"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { AlertCircle, Braces, ChevronDown, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SurfaceBadge, surfaceMeta } from "@/components/workflows/builder/surface-badge";
import { getStep, getTrigger, TRIGGERS } from "@/lib/workflows/catalog";
import type { WorkflowSpec, StepNode } from "@/lib/workflows/spec";
import { TRIGGER_EVENT_TYPES } from "@/lib/workflows/spec";
import { TRIGGER_NODE_ID } from "@/lib/workflows/graph";
import { STEP_FIELDS } from "@/lib/workflows/field-defs";
import { TypedStepForm } from "./typed-step-form";

// Right-side Sheet that opens when a node is selected.
//
// Layout:
//   • Header — surface badge, type label, surface name chip, description
//   • Body  — sectioned form. Conditional steps (branch_if, filter) get a
//             friendly "When [path] [operator] [value]" composer that emits
//             JSONLogic; everything else gets id + label + JSON config.
//   • Footer — Done button

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
        <TriggerEditor spec={spec} onChange={onChange} onClose={onClose} />
      ) : selectedNodeId ? (
        <StepEditor
          spec={spec}
          stepId={selectedNodeId}
          onChange={onChange}
          onClose={onClose}
        />
      ) : null}
    </NonModalSidePanel>
  );
}

// Non-modal side panel — slides in from the right but does NOT blur or
// block the rest of the page. The user can keep clicking on workflow steps
// to swap which one is being edited, scroll the list, etc. Closes via the
// X button, Escape, or programmatically.
function NonModalSidePanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Listen for Escape ourselves since modal={false} disables base-ui's
  // built-in dismiss handling on outside interactions.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(o) => !o && onClose()}
      modal={false}
    >
      <BaseDialog.Portal>
        {/* No Backdrop — the workflow behind stays fully visible + interactive */}
        <BaseDialog.Popup
          data-slot="inspector-panel"
          className={cn(
            "fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col gap-0",
            "border-l border-border bg-popover text-popover-foreground shadow-2xl",
            "transition-transform duration-200 ease-out",
            "data-starting-style:translate-x-full data-ending-style:translate-x-full",
          )}
        >
          {/* Float a close X that doesn't get hidden behind sheet headers */}
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
          <p className="mt-0.5 text-[11.5px] text-muted-foreground/80">
            {description}
          </p>
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
  onClose,
}: {
  spec: WorkflowSpec;
  onChange: (next: WorkflowSpec) => void;
  onClose: () => void;
}) {
  const meta = getTrigger(spec.trigger.event_type);

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
        description={
          meta?.description ?? "Choose what kicks this workflow off."
        }
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
          <ConditionEditor
            value={spec.trigger.filter?.expr}
            onChange={(expr) => {
              onChange({
                ...spec,
                trigger: {
                  ...spec.trigger,
                  filter: expr === undefined ? undefined : { expr },
                },
              });
            }}
            pathPrefix="trigger"
          />
        </Section>
      </div>

      <InspectorFooter onClose={onClose} />
    </>
  );
}

// ─── Step editor ────────────────────────────────────────────────────────────

function StepEditor({
  spec,
  stepId,
  onChange,
  onClose,
}: {
  spec: WorkflowSpec;
  stepId: string;
  onChange: (next: WorkflowSpec) => void;
  onClose: () => void;
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

    // Sweep references
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
        const branches = {
          ...(next as { branches: Record<string, string> }).branches,
        };
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
        title={meta?.label ?? step.type}
        description={meta?.description ?? ""}
      />

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <Section title="Step identity">
          <div className="grid gap-2">
            <Input
              value={draftId}
              onChange={(e) => setDraftId(e.target.value.replace(/[^a-z0-9_]/gi, "_"))}
              onBlur={commitRename}
              className="font-mono text-[12px]"
              placeholder="step_id"
            />
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={commitLabel}
              placeholder={`Label — defaults to "${meta?.label ?? step.type}"`}
              className="text-[12px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Use the step id inside template strings like{" "}
              <code className="font-mono text-muted-foreground">
                {`{{steps.${draftId}.output}}`}
              </code>
            </p>
          </div>
        </Section>

        {isConditional ? (
          <Section
            title="When this is true"
            description="Compose a condition; we'll save it as JSONLogic. Switch to JSON if you need full power."
          >
            <ConditionEditor
              value={(cfg as { expr?: unknown }).expr}
              onChange={(expr) =>
                commitConfig({ ...(cfg as object), expr })
              }
              pathPrefix="trigger"
            />
          </Section>
        ) : (
          <StepConfigSection
            stepType={step.type}
            value={cfg as Record<string, unknown>}
            onChange={commitConfig}
            explainHint={meta?.explain(cfg)}
          />
        )}
      </div>

      <InspectorFooter onClose={onClose} />
    </>
  );
}

// ─── Step config section (typed form + advanced JSON fallback) ─────────────

function StepConfigSection({
  stepType,
  value,
  onChange,
  explainHint,
}: {
  stepType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
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
    // No typed schema for this step — JSON is the only editor.
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
      <TypedStepForm fields={fields} value={value} onChange={onChange} />

      <details
        className="mt-3 rounded-md border border-border/60 bg-muted/[0.04]"
        open={showAdvanced}
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer select-none items-center gap-1 px-3 py-2 text-[11.5px] text-muted-foreground hover:text-foreground">
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

// ─── Header + footer ────────────────────────────────────────────────────────

function InspectorHeader({
  surface,
  kicker,
  title,
  description,
}: {
  surface: ReturnType<typeof surfaceMeta>["label"] extends never
    ? never
    : Parameters<typeof SurfaceBadge>[0]["surface"];
  kicker: string;
  title: string;
  description: string;
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
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-foreground">
            {title}
          </p>
        </div>
      </div>
      {description && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </header>
  );
}

function InspectorFooter({ onClose }: { onClose: () => void }) {
  return (
    <div className="border-t p-3">
      <Button onClick={onClose} size="sm" className="w-full">
        Done
      </Button>
    </div>
  );
}

// ─── Condition composer ───────────────────────────────────────────────────

const OPERATORS = [
  { id: "==", label: "is equal to" },
  { id: "!=", label: "is not equal to" },
  { id: ">", label: "is greater than" },
  { id: ">=", label: "is greater than or equal to" },
  { id: "<", label: "is less than" },
  { id: "<=", label: "is less than or equal to" },
  { id: "in", label: "contains (text)" },
  { id: "!", label: "is empty / false" },
] as const;

type Operator = (typeof OPERATORS)[number]["id"];

interface SimpleCondition {
  path: string;
  op: Operator;
  value: string;
}

/** Try to read a one-clause JSONLogic predicate. Returns null if unrecognised. */
function readSimpleCondition(expr: unknown): SimpleCondition | null {
  if (!expr || typeof expr !== "object") return null;
  const entries = Object.entries(expr as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [op, args] = entries[0]!;
  // { "!": [{ var: "path" }] } — empty/false
  if (op === "!" && Array.isArray(args) && args.length === 1) {
    const v = readVar(args[0]);
    if (v !== null) return { path: v, op: "!", value: "" };
  }
  // Binary operators: { "==": [{ var: "path" }, value] }
  if (
    Array.isArray(args) &&
    args.length === 2 &&
    OPERATORS.some((o) => o.id === op)
  ) {
    const v = readVar(args[0]);
    if (v !== null) {
      return {
        path: v,
        op: op as Operator,
        value: argToString(args[1]),
      };
    }
  }
  return null;
}

function readVar(v: unknown): string | null {
  if (
    v &&
    typeof v === "object" &&
    "var" in (v as object) &&
    typeof (v as { var: unknown }).var === "string"
  ) {
    return (v as { var: string }).var;
  }
  return null;
}

function argToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function makeCondition(c: SimpleCondition): unknown {
  const valueArg: unknown =
    c.value === ""
      ? ""
      : c.value === "true"
        ? true
        : c.value === "false"
          ? false
          : !Number.isNaN(Number(c.value)) && c.value.trim() !== ""
            ? Number(c.value)
            : c.value;

  if (c.op === "!") {
    return { "!": [{ var: c.path }] };
  }
  return { [c.op]: [{ var: c.path }, valueArg] };
}

function ConditionEditor({
  value,
  onChange,
  pathPrefix,
}: {
  value: unknown;
  onChange: (expr: unknown | undefined) => void;
  pathPrefix: string;
}) {
  const parsed = useMemo(() => readSimpleCondition(value), [value]);
  const [mode, setMode] = useState<"simple" | "json">(
    value === undefined ? "simple" : parsed ? "simple" : "json",
  );
  const [draft, setDraft] = useState<SimpleCondition>(
    parsed ?? { path: `${pathPrefix}.new.priority`, op: "==", value: "" },
  );

  useEffect(() => {
    if (parsed) setDraft(parsed);
  }, [parsed]);

  function emitSimple(next: Partial<SimpleCondition>) {
    const merged = { ...draft, ...next };
    setDraft(merged);
    onChange(merged.path ? makeCondition(merged) : undefined);
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
        <button
          type="button"
          onClick={() => setMode("simple")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5",
            mode === "simple" ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          <Sparkles className="size-3" /> Simple
        </button>
        <button
          type="button"
          onClick={() => setMode("json")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5",
            mode === "json" ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          <Braces className="size-3" /> JSON
        </button>
      </div>

      {mode === "simple" ? (
        <div className="grid gap-2">
          <Input
            value={draft.path}
            onChange={(e) => emitSimple({ path: e.target.value })}
            placeholder="e.g. trigger.new.priority"
            className="font-mono text-[12px]"
          />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select
              value={draft.op}
              onChange={(e) => emitSimple({ op: e.target.value as Operator })}
              className="h-9 rounded-md border border-input bg-background px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {OPERATORS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="rounded-md border border-input px-2 text-[11px] text-muted-foreground hover:bg-secondary"
              title="Clear condition"
            >
              Clear
            </button>
          </div>
          {draft.op !== "!" && (
            <Input
              value={draft.value}
              onChange={(e) => emitSimple({ value: e.target.value })}
              placeholder='e.g. "urgent" or 5 or true'
              className="text-[12px]"
            />
          )}
          {value !== undefined && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none hover:text-foreground">
                <ChevronDown className="inline size-3" /> Preview JSONLogic
              </summary>
              <pre className="mt-1 overflow-x-auto rounded-md bg-muted/30 p-2 font-mono text-[11px]">
                {JSON.stringify(value, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ) : (
        <JsonEditor
          value={value ?? {}}
          onChange={(next) =>
            onChange(
              next && typeof next === "object" && Object.keys(next).length === 0
                ? undefined
                : next,
            )
          }
          hint="Raw JSONLogic predicate. Common ops: ==, !=, >, <, in, !, and, or"
        />
      )}
    </div>
  );
}

// ─── JSON editor ───────────────────────────────────────────────────────────

function JsonEditor({
  value,
  onChange,
  hint,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  hint?: string;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
    setError(null);
  }, [value]);

  function commit() {
    try {
      const parsed = JSON.parse(text || "{}");
      onChange(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  return (
    <div className="space-y-1">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={Math.min(20, Math.max(5, text.split("\n").length))}
        className="font-mono text-[12px]"
      />
      {error ? (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="size-3" /> {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
