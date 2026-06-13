import "server-only";
import {
  createNotification,
  findAlreadyNotifiedUserIds,
} from "@/lib/notifications/server";
import type { WorkflowPayload } from "@/lib/notifications/types";

/**
 * Notify the workflow owner that a run failed. Rate-limited to one
 * notification per workflow per 24h (via the existing dedupe helper) so a
 * workflow failing on every trigger doesn't flood the activity feed — the
 * runs list carries the full failure history. Dry runs never notify: a
 * failing test is the author watching the inspector, not an incident.
 *
 * Never throws — failure notifications must not affect run finalization.
 */
export async function notifyWorkflowRunFailed(args: {
  propertyId: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  ownerId: string | null;
  error: string | null;
  isDryRun: boolean;
}): Promise<void> {
  if (args.isDryRun || !args.ownerId) return;
  try {
    const already = await findAlreadyNotifiedUserIds({
      userIds: [args.ownerId],
      type: "workflow",
      match: { key: "workflowId", value: args.workflowId },
    });
    if (already.has(args.ownerId)) return;

    const payload: WorkflowPayload = {
      kind: "run_failed",
      workflowId: args.workflowId,
      workflowName: args.workflowName,
      runId: args.runId,
      error: args.error,
    };
    await createNotification({
      userId: args.ownerId,
      propertyId: args.propertyId,
      type: "workflow",
      payload,
    });
  } catch (err) {
    console.error("[workflows] notifyWorkflowRunFailed failed:", err);
  }
}
