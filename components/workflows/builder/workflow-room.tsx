"use client";

import type { ReactNode } from "react";
import { RoomProvider } from "@liveblocks/react";
import { roomIdForWorkflow } from "@/lib/liveblocks/rooms";

/**
 * Wraps the workflow builder in a Liveblocks room (one per workflow) so it
 * grows live presence + a spec mirror. The room is a presence/awareness
 * channel — Postgres stays the source of truth, and only the editing client
 * persists (the receiver mirrors for display). The co-editing layer uses the
 * non-suspense hooks so the builder renders immediately while the socket
 * connects (presence simply fills in once ready).
 */
export function WorkflowRoom({
  propertyId,
  workflowId,
  children,
}: {
  propertyId: string;
  workflowId: string;
  children: ReactNode;
}) {
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
    >
      {children}
    </RoomProvider>
  );
}
