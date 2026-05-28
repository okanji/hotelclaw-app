import { NextResponse, type NextRequest, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";

// Manual trigger — emits a workflow_events row with source='manual' so the
// dispatcher handles it the same way as automatic triggers. The spec's
// trigger.event_type still has to be 'manual.run' for this to actually fire.

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

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  after(async () => {
    await emitWorkflowEvent({
      propertyId,
      source: "manual",
      eventType: "manual.run",
      entityId: workflowId,
      entityKind: "workflow",
      payload: { run_by_user_id: user.id, workflow_id: workflowId, input: body },
    });
  });

  return NextResponse.json({ queued: true });
}
