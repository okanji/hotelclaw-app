import "server-only";
import {
  captureToBrain,
  resolvePropertyBrain,
} from "@/lib/brain/client";
import { logBrainEvent } from "@/lib/brain/telemetry";
import { delegateToEve } from "@/lib/ai/eve-delegate";
import type { RunnerImpl } from "./types";

type CaptureConfig = { text: string; tags?: string[] };

export const gbrainCaptureRunner: RunnerImpl<
  CaptureConfig,
  { ok: boolean; stub?: boolean }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { ok: true };

  const binding = await resolvePropertyBrain(ctx.propertyId);
  if (!binding) {
    // Kept as a stub (not a run failure) for workflow back-compat, but the
    // skip is structured telemetry now — a brainless property running
    // capture steps is a provisioning gap someone should see.
    logBrainEvent("capture_skipped_no_binding", {
      surface: "workflow-capture",
      propertyId: ctx.propertyId,
      workflowId: ctx.workflowId,
      runId: ctx.runId,
    });
    return { ok: false, stub: true };
  }

  const result = await captureToBrain(binding, {
    slug: "operations/workflow-signals",
    pageTitle: "Workflow signals",
    summary: config.text.slice(0, 1000),
    ...(config.tags?.length ? { detail: `tags: ${config.tags.join(", ")}` } : {}),
    source: `workflow ${ctx.workflowId}, run ${ctx.runId}`,
  });
  if (!result.ok) throw new Error(`brain capture failed: ${result.reason}`);
  return { ok: true };
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
