"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, GitBranch, LayoutPanelLeft, List, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { classifyMode } from "@/lib/workflows/spec";
import { AiCopilot } from "./ai-copilot";
import { WorkflowGraphView } from "./graph-view";
import { WorkflowCanvas } from "./canvas/workflow-canvas";
import { TreeList } from "./tree-list/tree-list";

// Builder shell — owns:
//   • the in-memory spec
//   • the "saved baseline" (last persisted spec) for Reject
//   • the unaccepted diff set (step ids the AI added since last accept)
//   • save / accept-all / reject actions

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
  const [view, setView] = useState<"list" | "graph" | "canvas">("list");
  const dirty = spec !== savedSpec;
  const hasUnaccepted = unaccepted.size > 0;

  // Cmd+G / Ctrl+G cycles list → graph → canvas → list. Quick way to flip the
  // primary edit surface without leaving the keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setView((v) =>
          v === "list" ? "graph" : v === "graph" ? "canvas" : "list",
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // classifyMode might flip from instant → durable as the AI adds delay/wait nodes.
  const currentIsDurable = useMemo(() => classifyMode(spec) === "durable", [spec]);

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

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setSavedSpec(spec);
      setUnaccepted(new Set());
      toast.success("Workflow saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  // Layout
  //   • Header (status + view tabs + save) stays fixed at the top in every
  //     view, so users can flip between list/graph/canvas without losing
  //     orientation.
  //   • List / Graph use a constrained 820px reading column inside a
  //     vertical scroller — the existing comfortable width.
  //   • Canvas takes the full viewport edge-to-edge — node editors need
  //     all the horizontal real estate they can get; constraining to 820px
  //     overlaps nodes immediately.
  const isCanvas = view === "canvas";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn(
          "flex flex-shrink-0 flex-col items-stretch gap-2 border-b border-border/60 bg-background/60 px-4 py-2 sm:flex-row sm:items-center sm:justify-between",
          !isCanvas && "border-transparent bg-transparent",
        )}
      >
        <p className={cn("text-[12px] text-muted-foreground", !isCanvas && "px-6 pt-2")}>
          {dirty
            ? "Unsaved changes — review and save when ready."
            : "All caught up."}
          {currentIsDurable !== initialIsDurable
            ? " · Mode changed — this workflow now runs durably."
            : ""}
        </p>
        <div className={cn("flex items-center justify-end gap-2", !isCanvas && "px-6 pt-2")}>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
            <ViewTab
              icon={<List className="size-3" />}
              label="List"
              active={view === "list"}
              onClick={() => setView("list")}
            />
            <ViewTab
              icon={<GitBranch className="size-3" />}
              label="Graph"
              shortcut="⌘G"
              active={view === "graph"}
              onClick={() => setView("graph")}
            />
            <ViewTab
              icon={<LayoutPanelLeft className="size-3" />}
              label="Canvas"
              active={view === "canvas"}
              onClick={() => setView("canvas")}
            />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {hasUnaccepted ? (
        <div
          className={cn(
            "flex-shrink-0",
            isCanvas ? "px-4 pt-2" : "mx-auto w-full max-w-[820px] px-10 pt-4",
          )}
        >
          <AcceptBar
            count={unaccepted.size}
            onAccept={acceptAll}
            onReject={rejectAll}
          />
        </div>
      ) : null}

      {isCanvas ? (
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
            onClose={() => setView("list")}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[820px] flex-col gap-4 px-10 pt-6 pb-12">
            {view === "list" && (
              <TreeList
                spec={spec}
                isDurable={currentIsDurable}
                selectedStepId={selectedStepId}
                onSelectStep={setSelectedStepId}
                onChange={setSpec}
                unacceptedIds={unaccepted}
              />
            )}
            {view === "graph" && (
              <WorkflowGraphView
                spec={spec}
                unacceptedIds={unaccepted}
                selectedStepId={selectedStepId}
                onSelectStep={setSelectedStepId}
              />
            )}
            <AiCopilot
              propertyId={propertyId}
              currentSpec={spec}
              onSpec={applyAiSpec}
              busy={busy}
              setBusy={setBusy}
            />
          </div>
        </div>
      )}
    </div>
  );
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
    <div
      className={cn(
        "sticky top-0 z-10 flex items-center justify-between gap-3 rounded-md border border-[var(--chart-2)]/40 bg-[var(--chart-2)]/10 px-3 py-2 text-[13px]",
      )}
    >
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
