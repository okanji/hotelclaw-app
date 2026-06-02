"use client";

import { useEffect, useRef } from "react";
import {
  useMutation,
  useOthers,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";
import { TRIGGER_NODE_ID } from "@/lib/workflows/graph";
import { getStep } from "@/lib/workflows/catalog";
import type { WorkflowSpec, StepNode } from "@/lib/workflows/spec";

// CRDT-backed co-editing layer. The spec lives in Liveblocks Storage as a
// LiveObject { steps: LiveMap<id, json>, rest: json } — a LiveMap of steps so
// concurrent edits to *different* steps merge conflict-free. This component is
// the adapter between that shared doc and the builder's plain-spec API:
//   • Storage → local: reconstruct the spec and push it via onRemoteSpec.
//   • local → Storage: diff the spec and apply granular per-step ops.
// JSON-string comparisons guard against echo loops between the two directions.
// (Rendered inside a ClientSideSuspense, so the Storage hooks are safe.)

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function WorkflowCoEditing({
  spec,
  selectedStepId,
  onRemoteSpec,
}: {
  spec: WorkflowSpec;
  selectedStepId?: string;
  onRemoteSpec: (spec: WorkflowSpec) => void;
}) {
  const others = useOthers();
  const updatePresence = useUpdateMyPresence();

  // Reconstruct the shared spec from Storage as a canonical JSON string — a
  // string result means useStorage only re-renders when the content actually
  // changes (value comparison), and the loop guards stay cheap.
  const remoteJson = useStorage((root) => {
    const wf = root.workflow;
    if (!wf) return null;
    let rest: Record<string, unknown>;
    try {
      rest = JSON.parse(wf.rest) as Record<string, unknown>;
    } catch {
      return null;
    }
    const src = wf.steps as ReadonlyMap<string, string> | Record<string, string>;
    const entries =
      src instanceof Map ? Array.from(src.entries()) : Object.entries(src);
    const steps: Record<string, unknown> = {};
    for (const [id, json] of entries) {
      try {
        steps[id] = JSON.parse(json);
      } catch {
        /* skip a malformed step */
      }
    }
    return JSON.stringify({ ...rest, steps });
  });

  // The spec content we last wrote to / applied from Storage, so neither
  // direction echoes the other.
  const lastSynced = useRef(JSON.stringify(spec));

  // Storage → local.
  useEffect(() => {
    if (remoteJson == null || remoteJson === lastSynced.current) return;
    if (remoteJson === JSON.stringify(spec)) {
      lastSynced.current = remoteJson;
      return;
    }
    lastSynced.current = remoteJson;
    try {
      onRemoteSpec(JSON.parse(remoteJson) as WorkflowSpec);
    } catch {
      /* ignore a malformed remote spec */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteJson]);

  // local → Storage: diff the spec and apply per-step ops so different steps
  // merge instead of overwriting each other.
  const writeSpec = useMutation(({ storage }, next: WorkflowSpec) => {
    const wf = storage.get("workflow");
    if (!wf) return;
    const steps = wf.get("steps");
    const removed: string[] = [];
    steps.forEach((_value, key) => {
      if (!next.steps[key]) removed.push(key);
    });
    for (const key of removed) steps.delete(key);
    for (const [id, step] of Object.entries(next.steps)) {
      const json = JSON.stringify(step);
      if (steps.get(id) !== json) steps.set(id, json);
    }
    const rest = { ...next } as Record<string, unknown>;
    delete rest.steps;
    const restJson = JSON.stringify(rest);
    if (wf.get("rest") !== restJson) wf.set("rest", restJson);
  }, []);

  useEffect(() => {
    const localJson = JSON.stringify(spec);
    if (localJson === lastSynced.current) return;
    if (remoteJson != null && localJson === remoteJson) {
      lastSynced.current = localJson;
      return;
    }
    lastSynced.current = localJson;
    writeSpec(spec);
    // Run only on local spec edits; including remoteJson would re-write a stale
    // local spec over a peer's incoming change before our apply-effect lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, writeSpec]);

  // Publish which step I have open.
  useEffect(() => {
    updatePresence({ workflowSelectedStepId: selectedStepId ?? null });
  }, [selectedStepId, updatePresence]);

  if (others.length === 0) return null;

  return (
    <div className="flex items-center -space-x-1.5" aria-label="People editing this workflow">
      {others.slice(0, 5).map(({ connectionId, info, presence }) => {
        const stepId = presence.workflowSelectedStepId;
        const step =
          stepId && stepId !== TRIGGER_NODE_ID
            ? (spec.steps[stepId] as StepNode | undefined)
            : undefined;
        const where = step
          ? `editing ${step.label || getStep(step.type)?.label || step.type}`
          : stepId === TRIGGER_NODE_ID
            ? "editing the trigger"
            : "viewing";
        const name = info?.name ?? "Someone";
        return (
          <span
            key={connectionId}
            title={`${name} · ${where}`}
            className="inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-primary/15 text-[10px] font-medium text-foreground"
          >
            {initials(name) || "?"}
          </span>
        );
      })}
      {others.length > 5 ? (
        <span className="inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground">
          +{others.length - 5}
        </span>
      ) : null}
    </div>
  );
}
