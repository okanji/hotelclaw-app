"use client";

import { useEffect, useRef } from "react";
import {
  useBroadcastEvent,
  useEventListener,
  useOthers,
  useUpdateMyPresence,
} from "@liveblocks/react";
import { TRIGGER_NODE_ID } from "@/lib/workflows/graph";
import { getStep } from "@/lib/workflows/catalog";
import type { WorkflowSpec } from "@/lib/workflows/spec";

// Live co-editing layer for the builder. Renders the collaborator avatar stack,
// publishes this user's current step selection, and mirrors peers' spec edits
// in real time. Only the editing client persists (see applyRemoteSpec in
// builder-shell) — the room is a presence + display channel, Postgres stays
// authoritative and the optimistic lock guards concurrent saves.

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
  const broadcast = useBroadcastEvent();
  // The spec we last broadcast or applied from a peer — so applying a remote
  // spec doesn't echo back out, and our own edits aren't re-applied.
  const lastSynced = useRef<unknown>(spec);
  const revRef = useRef(0);

  // Publish which step I have open so peers see "Alice is on step 3".
  useEffect(() => {
    updatePresence({ workflowSelectedStepId: selectedStepId ?? null });
  }, [selectedStepId, updatePresence]);

  // Broadcast my spec edits (skip a spec that just arrived from a peer). The
  // spec goes over the wire JSON-stringified — Liveblocks RoomEvents must be
  // plain JSON values.
  useEffect(() => {
    if (spec === lastSynced.current) return;
    lastSynced.current = spec;
    revRef.current += 1;
    broadcast({ type: "workflow-spec", spec: JSON.stringify(spec), rev: revRef.current });
  }, [spec, broadcast]);

  // Mirror a peer's spec locally.
  useEventListener(({ event }) => {
    if (event.type !== "workflow-spec") return;
    let parsed: WorkflowSpec;
    try {
      parsed = JSON.parse(event.spec) as WorkflowSpec;
    } catch {
      return;
    }
    lastSynced.current = parsed;
    onRemoteSpec(parsed);
  });

  if (others.length === 0) return null;

  return (
    <div className="flex items-center -space-x-1.5" aria-label="People editing this workflow">
      {others.slice(0, 5).map(({ connectionId, info, presence }) => {
        const stepId = presence.workflowSelectedStepId;
        const step = stepId && stepId !== TRIGGER_NODE_ID ? spec.steps[stepId] : undefined;
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
