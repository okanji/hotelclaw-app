"use client";

import { Suspense } from "react";
import { RoomProvider } from "@liveblocks/react";
import { ArrowLeft } from "lucide-react";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import { triageAge } from "@/lib/tasks/triage-logic";
import type { TriageQueueItem } from "@/lib/query/triage-queries";
import { IntakeIcon } from "./triage-list";
import { Gi } from "@/components/gr8r/icon";

/**
 * The right pane: the selected item in the REAL task detail (`variant=
 * "embedded"` — the same body, properties, AI triage suggestions, activity
 * and comments every task has) under a slim header that carries Accept /
 * Decline. It mirrors `TaskRoom` instead of mounting it because TaskRoom
 * reads the board's `["tasks"]` cache, which deliberately excludes pending
 * tasks; here the row comes from the triage queue.
 */
export function TriageTaskPane({
  propertyId,
  task,
  decision,
  onBack,
}: {
  propertyId: string;
  task: TriageQueueItem;
  /** The Accept / Decline controls (owned by the view for shortcuts). */
  decision: React.ReactNode;
  /** Mobile only: back to the list. */
  onBack?: () => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="row"
        style={{
          height: 46,
          flexShrink: 0,
          padding: "0 var(--g8-gutter)",
          borderBottom: "1px solid var(--g8-border)",
          gap: 10,
        }}
      >
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to triage"
            className="ibtn ibtn-sm md:hidden"
          >
            <Gi icon={ArrowLeft} size={15} />
          </button>
        ) : null}
        <span className="badge amber">
          <span className="dot" />
          Needs triage
        </span>
        <span className="row muted" style={{ gap: 6, minWidth: 0, fontSize: 12.5 }}>
          <IntakeIcon intake={task.intake} />
          <span className="trunc">{task.intake.label}</span>
          <span aria-hidden="true">·</span>
          <span className="num" style={{ flexShrink: 0 }}>
            {triageAge(task.created_at)}
          </span>
        </span>
        <span className="sp" />
        {decision}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <RoomProvider
          key={task.id}
          id={`property:${propertyId}:task:${task.id}`}
          // Same presence shape as TaskRoom — the room is shared with anyone
          // viewing this task from the board later.
          initialPresence={{
            cursor: null,
            selectedTaskId: task.id,
            draggingTaskId: null,
            editingEventId: null,
            focusedDay: null,
            selectedCell: null,
            selectionRange: null,
            activeSheetId: null,
          }}
        >
          <Suspense fallback={<TaskDetailSkeleton />}>
            <TaskDetail
              key={task.id}
              propertyId={propertyId}
              variant="embedded"
              task={{
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                assigneeId: task.assignee_id,
                dueAt: task.due_at,
                recurrence: task.recurrence ?? null,
                createdAt: task.created_at,
                createdBy: task.created_by,
                source: task.source,
                sourceWorkflowId: task.source_workflow_id,
                sourceWorkflowRunId: task.source_workflow_run_id,
              }}
            />
          </Suspense>
        </RoomProvider>
      </div>
    </div>
  );
}
