"use client";

import { useEffect, useRef } from "react";
import { LiveMap, LiveObject } from "@liveblocks/client";
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
    let topRest: Record<string, unknown>;
    try {
      topRest = JSON.parse(wf.rest) as Record<string, unknown>;
    } catch {
      return null;
    }
    // wf.steps deserializes to a record/map of stepId → { rest, config }.
    type DeserStep = { rest: string; config: ReadonlyMap<string, string> | Record<string, string> };
    const src = wf.steps as ReadonlyMap<string, DeserStep> | Record<string, DeserStep>;
    const stepEntries = src instanceof Map ? Array.from(src.entries()) : Object.entries(src);
    const steps: Record<string, unknown> = {};
    for (const [id, stepObj] of stepEntries) {
      let stepRest: Record<string, unknown>;
      try {
        stepRest = JSON.parse(stepObj.rest) as Record<string, unknown>;
      } catch {
        continue;
      }
      const cfgSrc = stepObj.config;
      const cfgEntries =
        cfgSrc instanceof Map ? Array.from(cfgSrc.entries()) : Object.entries(cfgSrc ?? {});
      const config: Record<string, unknown> = {};
      for (const [k, vj] of cfgEntries) {
        try {
          config[k] = JSON.parse(vj);
        } catch {
          /* skip a malformed field */
        }
      }
      steps[id] = { ...stepRest, config };
    }
    return JSON.stringify({ ...topRest, steps });
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
    const stepsMap = wf.get("steps");

    // Drop removed steps.
    const removed: string[] = [];
    stepsMap.forEach((_value, key) => {
      if (!next.steps[key]) removed.push(key);
    });
    for (const key of removed) stepsMap.delete(key);

    // Upsert each step, diffing config field-by-field so concurrent edits to
    // different fields of the same step merge.
    for (const [id, step] of Object.entries(next.steps)) {
      const config = (step as { config?: Record<string, unknown> }).config ?? {};
      const stepRest = { ...step } as Record<string, unknown>;
      delete stepRest.config;
      const restJson = JSON.stringify(stepRest);

      const existing = stepsMap.get(id);
      if (!existing) {
        stepsMap.set(
          id,
          new LiveObject({
            rest: restJson,
            config: new LiveMap<string, string>(
              Object.entries(config).map(([k, v]) => [k, JSON.stringify(v)]),
            ),
          }),
        );
        continue;
      }
      if (existing.get("rest") !== restJson) existing.set("rest", restJson);
      const cfgMap = existing.get("config");
      const removedKeys: string[] = [];
      cfgMap.forEach((_v, k) => {
        if (!(k in config)) removedKeys.push(k);
      });
      for (const k of removedKeys) cfgMap.delete(k);
      for (const [k, v] of Object.entries(config)) {
        const vj = JSON.stringify(v);
        if (cfgMap.get(k) !== vj) cfgMap.set(k, vj);
      }
    }

    const topRest = { ...next } as Record<string, unknown>;
    delete topRest.steps;
    const restJson = JSON.stringify(topRest);
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
