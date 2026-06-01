"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, LayoutPanelLeft, List, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { classifyMode } from "@/lib/workflows/spec";
import { validateSpec } from "@/lib/workflows/validate";
import { STEP_FIELDS } from "@/lib/workflows/field-defs";
import { AiCopilot } from "./ai-copilot";
import { WorkflowCanvas } from "./canvas/workflow-canvas";
import { TreeList } from "./tree-list/tree-list";
import { PanZoomCanvas } from "./tree-list/pan-zoom-canvas";
import { WorkflowBuilderDataProvider } from "./workflow-builder-data";

const AUTOSAVE_DELAY_MS = 1200;

// Builder shell — owns:
//   • the in-memory spec
//   • the "saved baseline" (last persisted spec) for Reject
//   • the unaccepted diff set (step ids the AI added since last accept)
//   • debounced autosave + accept-all / reject actions
//
// Two views share that spec: "Flow" (the vertical editing rail — primary) and
// "Map" (the @xyflow canvas — a spatial read-mostly overview). Cmd/Ctrl+G
// toggles between them.

export function BuilderShell({
  propertyId,
  workflowId,
  initialSpec,
  isDurable: initialIsDurable,
}: {
  propertyId: string;
  workflowId: string;
  initialSpec: WorkflowSpec;
  isDurable: boolean;
}) {
  const [savedSpec, setSavedSpec] = useState<WorkflowSpec>(initialSpec);
  const [spec, setSpec] = useState<WorkflowSpec>(initialSpec);
  const [unaccepted, setUnaccepted] = useState<Set<string>>(new Set());
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "map">("flow");
  const saveSeq = useRef(0);
  const lastAutosaveAttempt = useRef<WorkflowSpec | null>(null);
  const debouncedSpec = useDebouncedValue(spec, AUTOSAVE_DELAY_MS);
  const dirty = spec !== savedSpec;
  const hasUnaccepted = unaccepted.size > 0;
  const canPersist = useMemo(() => validateSpec(spec).ok, [spec]);

  const persistSpec = useCallback(
    async (next: WorkflowSpec, options?: { silent?: boolean }): Promise<boolean> => {
      const seq = ++saveSeq.current;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/properties/${propertyId}/workflows/${workflowId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec: next }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        if (seq !== saveSeq.current) return false;
        setSavedSpec(next);
        setUnaccepted(new Set());
        if (!options?.silent) toast.success("Workflow saved");
        return true;
      } catch (err) {
        if (seq !== saveSeq.current) return false;
        const message = err instanceof Error ? err.message : "Save failed";
        setSaveError(message);
        if (!options?.silent) toast.error(message);
        return false;
      } finally {
        if (seq === saveSeq.current) setSaving(false);
      }
    },
    [propertyId, workflowId],
  );

  // Debounced autosave — skips invalid specs and avoids retry loops on failure.
  useEffect(() => {
    if (debouncedSpec === savedSpec) {
      lastAutosaveAttempt.current = null;
      return;
    }
    if (!validateSpec(debouncedSpec).ok) return;
    if (lastAutosaveAttempt.current === debouncedSpec) return;

    lastAutosaveAttempt.current = debouncedSpec;
    void persistSpec(debouncedSpec, { silent: true }).then((ok) => {
      if (ok) lastAutosaveAttempt.current = null;
    });
  }, [debouncedSpec, savedSpec, persistSpec]);

  // Cmd+G / Ctrl+G toggles Flow ↔ Map; Cmd+S / Ctrl+S saves immediately.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        e.preventDefault();
        setView((v) => (v === "flow" ? "map" : "flow"));
      } else if (key === "s") {
        e.preventDefault();
        if (dirty && canPersist && !saving) void persistSpec(spec);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, canPersist, saving, spec, persistSpec]);

  // classifyMode might flip from instant → durable as the AI adds delay/wait nodes.
  const currentIsDurable = useMemo(() => classifyMode(spec) === "durable", [spec]);

  // Per-step problems surfaced inline on the cards *before* Save: empty required
  // fields (from STEP_FIELDS) plus dangling refs / bad branch targets (from the
  // shared validator). First message per step wins.
  const invalidById = useMemo(() => computeInvalid(spec), [spec]);

  function applyAiSpec(next: WorkflowSpec) {
    const before = new Set(Object.keys(spec.steps));
    const newIds = Object.keys(next.steps).filter((id) => !before.has(id));
    setSpec(next);
    setUnaccepted(new Set(newIds));
  }

  function acceptAll() {
    setUnaccepted(new Set());
    toast.success(
      unaccepted.size === 1
        ? "Accepted 1 AI-added step"
        : `Accepted ${unaccepted.size} AI-added steps`,
    );
  }

  function rejectAll() {
    setSpec(savedSpec);
    setUnaccepted(new Set());
    toast.message("Reverted to last saved version");
  }

  const statusMessage = saving
    ? "Saving…"
    : saveError
      ? saveError
      : dirty
        ? canPersist
          ? "Unsaved changes…"
          : "Unsaved changes — fix errors to save."
        : "All caught up.";

  const isMap = view === "map";

  return (
    <WorkflowBuilderDataProvider propertyId={propertyId}>
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn(
          "flex flex-shrink-0 flex-col items-stretch gap-2 border-b border-border/60 bg-background/60 px-4 py-2 sm:flex-row sm:items-center sm:justify-between",
          !isMap && "border-transparent bg-transparent",
        )}
      >
        <p
          className={cn(
            "text-[12px]",
            saveError ? "text-destructive" : "text-muted-foreground",
            !isMap && "px-6 pt-2",
          )}
        >
          {statusMessage}
          {currentIsDurable !== initialIsDurable
            ? " · Mode changed — this workflow now runs durably."
            : ""}
        </p>
        <div className={cn("flex items-center justify-end gap-2", !isMap && "px-6 pt-2")}>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
            <ViewTab
              icon={<List className="size-3" />}
              label="Flow"
              active={view === "flow"}
              onClick={() => setView("flow")}
            />
            <ViewTab
              icon={<LayoutPanelLeft className="size-3" />}
              label="Map"
              shortcut="⌘G"
              active={view === "map"}
              onClick={() => setView("map")}
            />
          </div>
        </div>
      </header>

      {hasUnaccepted ? (
        <div
          className={cn(
            "flex-shrink-0",
            isMap ? "px-4 pt-2" : "mx-auto w-full max-w-[820px] px-10 pt-4",
          )}
        >
          <AcceptBar count={unaccepted.size} onAccept={acceptAll} onReject={rejectAll} />
        </div>
      ) : null}

      {isMap ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <WorkflowCanvas
            propertyId={propertyId}
            spec={spec}
            setSpec={setSpec}
            unacceptedIds={unaccepted}
            applyAiSpec={applyAiSpec}
            busy={busy}
            setBusy={setBusy}
            selectedNodeId={selectedStepId ?? null}
            setSelectedNodeId={(id) => setSelectedStepId(id ?? undefined)}
            onClose={() => setView("flow")}
          />
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <PanZoomCanvas className="flex-1">
            <div className="px-10 pt-6 pb-40">
              <TreeList
                spec={spec}
                propertyId={propertyId}
                isDurable={currentIsDurable}
                selectedStepId={selectedStepId}
                onSelectStep={setSelectedStepId}
                onChange={setSpec}
                unacceptedIds={unaccepted}
                invalidById={invalidById}
              />
            </div>
          </PanZoomCanvas>
          {/* AI co-pilot floats over the canvas, centered at the bottom. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
            <div className="pointer-events-auto w-full max-w-2xl">
              <AiCopilot
                propertyId={propertyId}
                currentSpec={spec}
                onSpec={applyAiSpec}
                busy={busy}
                setBusy={setBusy}
              />
            </div>
          </div>
        </div>
      )}
    </div>
    </WorkflowBuilderDataProvider>
  );
}

// Map step id → first human-readable problem, for inline card validation.
function computeInvalid(spec: WorkflowSpec): Map<string, string> {
  const out = new Map<string, string>();

  // Empty required fields (drives the friendly "X is required" inline note).
  for (const [id, step] of Object.entries(spec.steps)) {
    const fields = STEP_FIELDS[step.type as keyof typeof STEP_FIELDS];
    if (!fields) continue;
    const cfg = (step as { config?: Record<string, unknown> }).config ?? {};
    for (const f of fields) {
      if (!("required" in f) || !f.required) continue;
      const v = cfg[f.key];
      const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) {
        out.set(id, `${f.label} is required`);
        break;
      }
    }
  }

  // Structural problems (dangling refs, bad branch targets) — don't overwrite a
  // required-field message already set for the step.
  for (const issue of validateSpec(spec).issues) {
    if (issue.severity !== "error" || !issue.step_id) continue;
    if (!out.has(issue.step_id)) out.set(issue.step_id, issue.message);
  }

  return out;
}

function ViewTab({
  icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function AcceptBar({
  count,
  onAccept,
  onReject,
}: {
  count: number;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-md border border-[var(--chart-2)]/40 bg-[var(--chart-2)]/10 px-3 py-2 text-[13px]">
      <span className="font-medium text-foreground">
        AI added {count} {count === 1 ? "step" : "steps"}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReject}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] hover:bg-muted"
        >
          <X className="size-3" aria-hidden />
          Reject
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[12px] font-medium text-background hover:opacity-90"
        >
          <Check className="size-3" aria-hidden />
          Accept all
        </button>
      </div>
    </div>
  );
}
