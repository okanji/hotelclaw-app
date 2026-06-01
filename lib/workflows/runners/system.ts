import "server-only";
import { getGbrainClient } from "@/lib/ai/mcp-clients";
import { resolvePropertyOpenclawConfig } from "@/lib/ai/openclaw-config";
import type { RunnerImpl } from "./types";

type CaptureConfig = { text: string; tags?: string[] };

export const gbrainCaptureRunner: RunnerImpl<
  CaptureConfig,
  { ok: boolean; stub?: boolean }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { ok: true };

  const client = await getGbrainClient(ctx.propertyId);
  if (!client) {
    console.log("[workflow:gbrain.capture:stub]", {
      propertyId: ctx.propertyId,
      workflowId: ctx.workflowId,
      runId: ctx.runId,
      text: config.text,
      tags: config.tags,
    });
    return { ok: false, stub: true };
  }

  const tools = await client.tools();
  const capture = tools.capture;
  if (!capture?.execute) {
    throw new Error("gbrain capture tool not available");
  }

  await capture.execute(
    {
      text: config.text,
      ...(config.tags?.length ? { tags: config.tags } : {}),
    },
    { toolCallId: `wf-${ctx.runId}-${ctx.stepId}`, messages: [] },
  );
  return { ok: true };
};

type DelegateConfig = {
  goal: string;
  context?: Record<string, unknown>;
};

export const delegateToOpenclawRunner: RunnerImpl<
  DelegateConfig,
  { queued: boolean; stub?: boolean; jobId?: string; error?: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { queued: true, stub: true };

  const cfg = await resolvePropertyOpenclawConfig(ctx.propertyId);
  if (!cfg) {
    console.log("[workflow:delegate_to_openclaw:stub]", {
      propertyId: ctx.propertyId,
      workflowId: ctx.workflowId,
      runId: ctx.runId,
      goal: config.goal,
      context: config.context,
    });
    return { queued: true, stub: true };
  }

  const { url, token } = cfg;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        skill: "workflow_goal",
        args: {
          goal: config.goal,
          context: config.context ?? {},
        },
        schedule: "once",
        summary: config.goal.slice(0, 280),
        scope: {
          propertyId: ctx.propertyId,
          userId: ctx.workflowOwnerId,
          surface: "workflow-step",
          workflowId: ctx.workflowId,
          runId: ctx.runId,
          stepId: ctx.stepId,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        queued: false,
        error: `OpenClaw returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const body = await res.json().catch(() => ({}));
    return {
      queued: true,
      jobId: (body as { jobId?: string }).jobId,
    };
  } catch (err) {
    console.error("[workflow:delegate_to_openclaw] fetch failed", err);
    return { queued: false, error: "Could not reach OpenClaw" };
  }
};
