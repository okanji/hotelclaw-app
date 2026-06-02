"use client";

import { useMemo, type ReactNode } from "react";
import { LiveMap, LiveObject } from "@liveblocks/client";
import { RoomProvider } from "@liveblocks/react";
import { roomIdForWorkflow } from "@/lib/liveblocks/rooms";
import type { WorkflowSpec } from "@/lib/workflows/spec";

/**
 * Wraps the workflow builder in a Liveblocks room (one per workflow) so it
 * grows live presence + a CRDT-backed shared spec. The spec lives in Storage as
 * a LiveObject { steps: LiveMap, rest: string } — steps keyed by id so
 * concurrent edits to different steps merge conflict-free. `initialStorage`
 * seeds the room from the DB spec the first time it's opened (ignored
 * thereafter — joiners get the existing shared doc). Postgres stays the durable
 * snapshot; the room is the live source of truth while people are editing.
 */
export function WorkflowRoom({
  propertyId,
  workflowId,
  initialSpec,
  children,
}: {
  propertyId: string;
  workflowId: string;
  initialSpec: WorkflowSpec;
  children: ReactNode;
}) {
  const initialStorage = useMemo(() => {
    const { steps, ...rest } = initialSpec;
    const stepsMap = new LiveMap<
      string,
      LiveObject<{ rest: string; config: LiveMap<string, string> }>
    >(
      Object.entries(steps).map(([id, step]) => {
        const s = step as { config?: Record<string, unknown> };
        const config = s.config ?? {};
        const stepRest = { ...step } as Record<string, unknown>;
        delete stepRest.config;
        return [
          id,
          new LiveObject({
            rest: JSON.stringify(stepRest),
            config: new LiveMap<string, string>(
              Object.entries(config).map(([k, v]) => [k, JSON.stringify(v)]),
            ),
          }),
        ];
      }),
    );
    return {
      workflow: new LiveObject({ steps: stepsMap, rest: JSON.stringify(rest) }),
    };
    // initialStorage only applies on first room creation; recomputing on a new
    // spec identity is fine and cheap.
  }, [initialSpec]);

  return (
    <RoomProvider
      id={roomIdForWorkflow(propertyId, workflowId)}
      initialPresence={{
        cursor: null,
        selectedTaskId: null,
        draggingTaskId: null,
        editingEventId: null,
        focusedDay: null,
        selectedCell: null,
        selectionRange: null,
        activeSheetId: null,
        workflowSelectedStepId: null,
      }}
      initialStorage={initialStorage}
    >
      {children}
    </RoomProvider>
  );
}
