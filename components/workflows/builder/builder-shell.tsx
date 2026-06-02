"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, History, LayoutPanelLeft, List, Redo2, Undo2, X } from "lucide-react";
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
import { VersionHistoryDialog } from "./version-history-dialog";

const AUTOSAVE_DELAY_MS = 1200;
// Edits within this window collapse into a single undo checkpoint.
const HISTORY_COALESCE_MS = 500;
const MAX_HISTORY = 100;

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
  initialVersionId = null,
}: {
  propertyId: string;
  workflowId: string;
  initialSpec: WorkflowSpec;
  isDurable: boolean;
  /** current_version_id at load — used for optimistic-concurrency on save. */
  initialVersionId?: string | null;
}) {
  const [savedSpec, setSavedSpec] = useState<WorkflowSpec>(initialSpec);
  const [spec, setSpec] = useState<WorkflowSpec>(initialSpec);
  const [unaccepted, setUnaccepted] = useState<Set<string>>(new Set());
  // The version our edits are based on; updated after each successful save. If
  // the server's current version diverges, the save 409s (concurrent editor).
  const baseVersionId = useRef<string | null>(initialVersionId);
  const [conflict, setConflict] = useState(false);
  // Snapshot of the spec immediately before the last AI apply, so Reject removes
  // only the AI's changes instead of reverting to the (possibly much older) last
  // saved version and discarding the user's own unsaved edits.
  const [preAiSpec, setPreAiSpec] = useState<WorkflowSpec | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "map">("flow");
  const [historyOpen, setHistoryOpen] = useState(false);
  const saveSeq = useRef(0);
  const lastAutosaveAttempt = useRef<WorkflowSpec | null>(null);
  const debouncedSpec = useDebouncedValue(spec, AUTOSAVE_DELAY_MS);
  const dirty = spec !== savedSpec;
  const hasUnaccepted = unaccepted.size > 0;
  const validation = useMemo(() => validateSpec(spec), [spec]);
  const canPersist = validation.ok;
  // Blocking errors that aren't pinned to a visible card (empty entry_step_id,
  // top-level Zod failures, trigger problems). Without surfacing these, autosave
  // silently stops while the status line says "fix the errors above" — but there
  // is nothing above. We render them in a banner instead.
  const unattachedErrors = useMemo(
    () =>
      validation.issues.filter(
        (i) => i.severity === "error" && (!i.step_id || !spec.steps[i.step_id]),
      ),
    [validation, spec.steps],
  );

  // ─── Undo / redo ──────────────────────────────────────────────────────────
  // The spec is the single source of truth, so all edits flow through
  // commitSpec, which checkpoints the prior spec onto an undo stack. Rapid
  // edits (e.g. typing in a config field) coalesce into one checkpoint within a
  // short window so undo steps are meaningful rather than per-keystroke.
  const specRef = useRef(spec);
  useEffect(() => {
    specRef.current = spec;
  }, [spec]);
  const lastEditAt = useRef(0);
  const [history, setHistory] = useState<{ past: WorkflowSpec[]; future: WorkflowSpec[] }>({
    past: [],
    future: [],
  });

  const commitSpec = useCallback((next: WorkflowSpec, opts?: { checkpoint?: boolean }) => {
    const prev = specRef.current;
    if (next === prev) return;
    const now = Date.now();
    const coalesce = !opts?.checkpoint && now - lastEditAt.current < HISTORY_COALESCE_MS;
    lastEditAt.current = now;
    setHistory((h) => {
      if (coalesce) return h.future.length ? { past: h.past, future: [] } : h;
      const past = [...h.past, prev];
      if (past.length > MAX_HISTORY) past.shift();
      return { past, future: [] };
    });
    setSpec(next);
  }, []);

  const undo = useCallback(() => {
    lastEditAt.current = 0;
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      setSpec(prev);
      return { past: h.past.slice(0, -1), future: [specRef.current, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    lastEditAt.current = 0;
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      setSpec(next);
      return { past: [...h.past, specRef.current], future: h.future.slice(1) };
    });
  }, []);

  const persistSpec = useCallback(
    async (next: WorkflowSpec, options?: { silent?: boolean }): Promise<boolean> => {
      const seq = ++saveSeq.current;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/properties/${propertyId}/workflows/${workflowId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec: next, baseVersionId: baseVersionId.current }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          conflict?: boolean;
          currentVersionId?: string | null;
        };
        if (!res.ok) {
          if (res.status === 409 || data.conflict) setConflict(true);
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        if (seq !== saveSeq.current) return false;
        // Advance our base version so the next save's optimistic check passes.
        if (data.currentVersionId) baseVersionId.current = data.currentVersionId;
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
  // Gated on acceptance: while AI-proposed steps are unaccepted, nothing is
  // persisted, so the Accept/Reject bar is a real gate rather than cosmetic.
  // Clearing `unaccepted` (Accept all) re-runs this effect and saves.
  useEffect(() => {
    if (debouncedSpec === savedSpec) {
      lastAutosaveAttempt.current = null;
      return;
    }
    if (conflict) return; // stop autosaving once another editor has diverged
    if (unaccepted.size > 0) return;
    if (!validateSpec(debouncedSpec).ok) return;
    if (lastAutosaveAttempt.current === debouncedSpec) return;

    lastAutosaveAttempt.current = debouncedSpec;
    void persistSpec(debouncedSpec, { silent: true }).then((ok) => {
      if (ok) lastAutosaveAttempt.current = null;
    });
  }, [debouncedSpec, savedSpec, persistSpec, unaccepted, conflict]);

  // Cmd+G toggles Flow ↔ Map; Cmd+S saves; Cmd+Z undo / Cmd+Shift+Z (or Cmd+Y)
  // redo.
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
      } else if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, canPersist, saving, spec, persistSpec, undo, redo]);

  // Guard against losing unsaved work on tab close / reload / external nav.
  // Autosave debounces by AUTOSAVE_DELAY_MS, so there's always a window where
  // edits aren't persisted; warn before the browser discards them.
  useEffect(() => {
    if (!dirty && !saving) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saving]);

  // classifyMode might flip from instant → durable as the AI adds delay/wait nodes.
  const currentIsDurable = useMemo(() => classifyMode(spec) === "durable", [spec]);

  // Per-step problems surfaced inline on the cards *before* Save: empty required
  // fields (from STEP_FIELDS) plus dangling refs / bad branch targets (from the
  // shared validator). First message per step wins.
  const invalidById = useMemo(() => computeInvalid(spec), [spec]);

  // Non-blocking, step-attached warnings (orphan / cycle) shown in amber. Errors
  // already live in invalidById and take visual precedence on the card.
  const warningById = useMemo(() => {
    const out = new Map<string, string>();
    for (const issue of validation.issues) {
      if (issue.severity !== "warning" || !issue.step_id) continue;
      if (!out.has(issue.step_id)) out.set(issue.step_id, issue.message);
    }
    return out;
  }, [validation]);

  function applyAiSpec(next: WorkflowSpec) {
    const before = new Set(Object.keys(spec.steps));
    const newIds = Object.keys(next.steps).filter((id) => !before.has(id));
    setPreAiSpec(spec); // capture the pre-apply state so Reject can return here
    commitSpec(next, { checkpoint: true }); // an AI apply is always its own undo step
    setUnaccepted(new Set(newIds));
  }

  function acceptAll() {
    const count = unaccepted.size;
    setUnaccepted(new Set()); // clearing the gate lets autosave persist (effect)
    setPreAiSpec(null);
    toast.success(count === 1 ? "Accepted 1 AI-added step" : `Accepted ${count} AI-added steps`);
  }

  function rejectAll() {
    // Restore only to the pre-AI state, preserving the user's own edits made
    // before the AI ran (not all the way back to the last saved version).
    if (preAiSpec) setSpec(preAiSpec);
    setUnaccepted(new Set());
    setPreAiSpec(null);
    toast.message("Removed the AI's changes");
  }

  const statusMessage = saving
    ? "Saving…"
    : saveError
      ? saveError
      : hasUnaccepted
        ? "Review the AI's changes above to save."
        : dirty
          ? canPersist
            ? "Saving automatically…"
            : unattachedErrors.length > 0
              ? "Can't save yet — see the issue above."
              : "Fix the highlighted steps to save."
          : "All changes saved.";

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
            ? " · This workflow now waits for events (you added a step that pauses or delays it)."
            : ""}
        </p>
        <div className={cn("flex items-center justify-end gap-2", !isMap && "px-6 pt-2")}>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            <IconButton
              label="Undo (⌘Z)"
              disabled={history.past.length === 0}
              onClick={undo}
            >
              <Undo2 className="size-3.5" />
            </IconButton>
            <IconButton
              label="Redo (⌘⇧Z)"
              disabled={history.future.length === 0}
              onClick={redo}
            >
              <Redo2 className="size-3.5" />
            </IconButton>
            <IconButton label="Version history" onClick={() => setHistoryOpen(true)}>
              <History className="size-3.5" />
            </IconButton>
          </div>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
            <ViewTab
              icon={<List className="size-3" />}
              label="Steps"
              shortcut="⌘G"
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
          <SaveButton
            dirty={dirty}
            saving={saving}
            canPersist={canPersist}
            onSave={() => void persistSpec(spec)}
          />
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

      {conflict ? (
        <div
          className={cn(
            "flex-shrink-0",
            isMap ? "px-4 pt-2" : "mx-auto w-full max-w-[820px] px-10 pt-4",
          )}
        >
          <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-medium text-foreground">This workflow changed elsewhere</p>
                <p className="text-muted-foreground">
                  Someone else (or another tab) saved a newer version. Autosave is paused to avoid
                  overwriting it — reload to get the latest.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="shrink-0 rounded-md bg-foreground px-2.5 py-1 text-[12px] font-medium text-background hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      ) : null}

      {dirty && unattachedErrors.length > 0 ? (
        <div
          className={cn(
            "flex-shrink-0",
            isMap ? "px-4 pt-2" : "mx-auto w-full max-w-[820px] px-10 pt-4",
          )}
        >
          <SpecErrorBanner messages={unattachedErrors.map(humanizeSpecIssue)} />
        </div>
      ) : null}

      {warningById.size > 0 ? (
        <div
          className={cn(
            "flex-shrink-0",
            isMap ? "px-4 pt-2" : "mx-auto w-full max-w-[820px] px-10 pt-4",
          )}
        >
          <WarningBanner messages={[...warningById.values()]} />
        </div>
      ) : null}

      {isMap ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <WorkflowCanvas
            propertyId={propertyId}
            spec={spec}
            setSpec={commitSpec}
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
          {busy ? (
            <div
              className="pointer-events-none absolute inset-0 z-20 bg-background/35 backdrop-blur-[2px]"
              aria-hidden
            />
          ) : null}
          <PanZoomCanvas className="flex-1">
            <div className="px-10 pt-6 pb-40">
              <TreeList
                spec={spec}
                propertyId={propertyId}
                isDurable={currentIsDurable}
                selectedStepId={selectedStepId}
                onSelectStep={setSelectedStepId}
                onChange={commitSpec}
                unacceptedIds={unaccepted}
                invalidById={invalidById}
                warningById={warningById}
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

      <VersionHistoryDialog
        propertyId={propertyId}
        workflowId={workflowId}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
    </WorkflowBuilderDataProvider>
  );
}

// Turn a spec-level (non-card) validation error into plain language for the
// banner. Falls back to the raw validator message for anything unmapped.
function humanizeSpecIssue(issue: { path: string; message: string }): string {
  if (issue.path === "entry_step_id") {
    return "This workflow has no starting step yet. Add a step so the trigger has somewhere to go.";
  }
  if (issue.path === "name") {
    return "Give this workflow a name before saving.";
  }
  if (issue.path.startsWith("trigger")) {
    return `The trigger needs attention: ${issue.message}`;
  }
  return issue.message;
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

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SaveButton({
  dirty,
  saving,
  canPersist,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  canPersist: boolean;
  onSave: () => void;
}) {
  // Saved (clean) → calm, disabled. Dirty + valid → primary, enabled. Dirty +
  // invalid → disabled (the banner / card errors say why). Saving → in-flight.
  const label = saving ? "Saving…" : dirty ? "Save" : "Saved";
  const disabled = saving || !dirty || !canPersist;
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled}
      title={
        !dirty
          ? "All changes saved"
          : !canPersist
            ? "Resolve the issues above to save"
            : "Save now (⌘S)"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
        !dirty
          ? "text-muted-foreground"
          : canPersist
            ? "bg-foreground text-background hover:opacity-90"
            : "cursor-not-allowed border border-border text-muted-foreground opacity-70",
      )}
    >
      {!dirty && !saving ? (
        <Check className="size-3.5" aria-hidden />
      ) : null}
      {label}
    </button>
  );
}

function SpecErrorBanner({ messages }: { messages: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-foreground">This workflow can&apos;t be saved yet</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WarningBanner({ messages }: { messages: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-foreground">Heads up — this still saves</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </div>
    </div>
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
