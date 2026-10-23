import "server-only";
import { rememberForProperty } from "@/lib/memory/store";
import { delegateToEve } from "@/lib/ai/eve-delegate";
import type { RunnerImpl } from "./types";

type CaptureConfig = { text: string; tags?: string[] };

/**
 * `action.gbrain.capture` — keeps its historical id so saved workflows keep
 * working; it now writes a row into property memory (gbrain retired
 * 2026-10-23). Every property has memory, so the old "no binding" stub
 * state no longer exists.
 */
export const gbrainCaptureRunner: RunnerImpl<
  CaptureConfig,
  { ok: boolean; stub?: boolean; memory_id?: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { ok: true };

  const id = await rememberForProperty({
    propertyId: ctx.propertyId,
    kind: "fact",
    content: config.text.slice(0, 2000),
    source: `workflow ${ctx.workflowId}, run ${ctx.runId}`,
    tags: config.tags ?? [],
    createdBy: ctx.workflowOwnerId ?? null,
  });
  if (!id) throw new Error("memory write failed");
  return { ok: true, memory_id: id };
};

type DelegateConfig = {
  goal: string;
  context?: Record<string, unknown>;
};

/**
 * Workflow delegation to the durable eve runtime (the action id keeps its
 * historical `action.external.delegate_to_openclaw` name so saved
 * workflows keep working — OpenClaw itself is retired).
 */
export const delegateToOpenclawRunner: RunnerImpl<
  DelegateConfig,
  { queued: boolean; stub?: boolean; jobId?: string; error?: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { queued: true, stub: true };

  const brief = [
    `Workflow-delegated goal: ${config.goal}`,
    config.context && Object.keys(config.context).length
      ? `Context:\n${JSON.stringify(config.context, null, 2).slice(0, 2000)}`
      : "",
    "Complete the goal using your tools. Record outcomes in the app (tasks/notifications) where appropriate.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await delegateToEve({
    propertyId: ctx.propertyId,
    userId: ctx.workflowOwnerId,
    brief,
  });
  if (!result.ok) {
    return { queued: false, error: `Agent runtime unavailable: ${result.reason}` };
  }
  return { queued: true, jobId: result.sessionId };
};
