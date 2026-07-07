import { NextResponse, type NextRequest, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import { runWorkflowNow } from "@/lib/workflows/dispatcher";

// Run-now / replay / test endpoint for a single workflow.
//
//   { replayRunId }  → replay a past run's exact trigger payload through the
//                      current spec, regardless of trigger type. Real side
//                      effects fire (it's a re-run). Returns the new run id.
//   { dryRun: true } → execute with dryRun so runners produce synthetic output
//                      and skip side effects (a safe test). Returns the run id.
//   {}               → manual trigger: emit a manual.run event (only fires if
//                      the workflow's trigger is literally 'manual.run').

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; workflowId: string }> },
) {
  const { propertyId, workflowId } = await params;
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
    .select("id, enabled")
    .eq("id", workflowId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!workflow) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { replayRunId?: string; dryRun?: boolean; input?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
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
