import { requireFullMember } from "@/lib/auth/session";
import { NextResponse, type NextRequest, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import { runWorkflowNow } from "@/lib/workflows/dispatcher";
import { RUN_NOW_TRIGGERS } from "@/lib/workflows/summary";

// Run-now / replay / test endpoint for a single workflow.
//
//   { replayRunId }  → replay a past run's exact trigger payload through the
//                      current spec, regardless of trigger type. Real side
//                      effects fire (it's a re-run). Returns the new run id.
//   { dryRun: true } → execute with dryRun so runners produce synthetic output
//                      and skip side effects (a safe test). Returns the run id.
//   { runNow: true } → "Run now" (Linear's loop button): run an ENABLED
//                      workflow whose trigger needs no event — manual.run or a
//                      schedule — immediately, with the payload its trigger
//                      would have produced. Returns the run id so the UI can
//                      open it.
//   {}               → manual trigger: emit a manual.run event (only fires if
//                      the workflow's trigger is literally 'manual.run').

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; workflowId: string }> },
) {
  const { propertyId, workflowId } = await params;
  // Guests (0118) hold a membership row but this route acts through the
  // service client, past RLS — full members only.
  const roleGate = await requireFullMember(propertyId);
  if (!roleGate.ok) return NextResponse.json({ error: roleGate.error }, { status: roleGate.status });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Sanity: workflow must exist + belong to this property.
  const service = createServiceClient();
  const { data: workflow } = await service
    .from("workflows")
    .select("id, enabled, current_version_id")
    .eq("id", workflowId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!workflow) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: {
    replayRunId?: string;
    dryRun?: boolean;
    runNow?: boolean;
    input?: Record<string, unknown>;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.runNow) {
    if (!workflow.enabled) {
      return NextResponse.json(
        { error: "Turn this workflow on before running it." },
        { status: 409 },
      );
    }
    const trigger = await currentTriggerType(service, workflow.current_version_id);
    if (!trigger || !RUN_NOW_TRIGGERS.has(trigger)) {
      return NextResponse.json(
        { error: "Only manual and scheduled workflows can be run on demand." },
        { status: 400 },
      );
    }
    // Same payload shapes the real trigger emits: manual.run from the emit
    // below, schedule.* from workflows_emit_cron_event.
    const triggerPayload =
      trigger === "manual.run"
        ? { run_by_user_id: user.id, workflow_id: workflowId, input: body.input ?? {} }
        : { workflow_id: workflowId, fired_at: new Date().toISOString() };
    try {
      const { runId, status } = await runWorkflowNow({
        workflowId,
        propertyId,
        triggerPayload,
        triggeredByUserId: user.id,
      });
      return NextResponse.json({ runId, status });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "run failed" },
        { status: 400 },
      );
    }
  }

  // Replay / test: run the current spec directly with a concrete payload.
  if (body.replayRunId || body.dryRun) {
    let triggerPayload: Record<string, unknown> = body.input ?? {};
    if (body.replayRunId) {
      const { data: priorRun } = await service
        .from("workflow_runs")
        .select("input")
        .eq("id", body.replayRunId)
        .eq("property_id", propertyId)
        .maybeSingle();
      if (!priorRun) return NextResponse.json({ error: "run not found" }, { status: 404 });
      triggerPayload = (priorRun.input as Record<string, unknown>) ?? {};
    }
    try {
      const { runId, status } = await runWorkflowNow({
        workflowId,
        propertyId,
        triggerPayload,
        triggeredByUserId: user.id,
        dryRun: Boolean(body.dryRun),
      });
      return NextResponse.json({ runId, status });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "run failed" },
        { status: 400 },
      );
    }
  }

  // Manual trigger — emits a workflow_events row the dispatcher picks up. Only
  // fires if the workflow's trigger.event_type is 'manual.run'.
  after(async () => {
    await emitWorkflowEvent({
      propertyId,
      source: "manual",
      eventType: "manual.run",
      entityId: workflowId,
      entityKind: "workflow",
      payload: { run_by_user_id: user.id, workflow_id: workflowId, input: body.input ?? {} },
    });
  });

  return NextResponse.json({ queued: true });
}

async function currentTriggerType(
  service: ReturnType<typeof createServiceClient>,
  versionId: string | null,
): Promise<string | null> {
  if (!versionId) return null;
  const { data } = await service
    .from("workflow_versions")
    .select("spec")
    .eq("id", versionId)
    .maybeSingle();
  const spec = data?.spec as { trigger?: { event_type?: string } } | null;
  return spec?.trigger?.event_type ?? null;
}
