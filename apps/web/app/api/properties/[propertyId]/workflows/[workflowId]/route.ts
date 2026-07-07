import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { saveWorkflow, WorkflowConflictError } from "@/lib/workflows/save";

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  spec: z.unknown().optional(),
  notes: z.string().nullable().optional(),
  baseVersionId: z.string().nullable().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; workflowId: string }> },
) {
  const { propertyId, workflowId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data: workflow, error } = await supabase
    .from("workflows")
    .select(
      "id, name, description, enabled, mode, current_version_id, webhook_token, last_run_at, last_run_status, created_at, updated_at",
    )
    .eq("id", workflowId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!workflow) return NextResponse.json({ error: "not found" }, { status: 404 });

  let spec: Record<string, unknown> | null = null;
  if (workflow.current_version_id) {
    const { data: version } = await supabase
      .from("workflow_versions")
      .select("spec")
      .eq("id", workflow.current_version_id)
      .maybeSingle();
    spec = (version?.spec as Record<string, unknown>) ?? null;
  }

  return NextResponse.json({ workflow, spec });
}

export async function PATCH(
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

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  try {
    const result = await saveWorkflow({
      workflowId,
      propertyId,
      userId: user.id,
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      spec: body.spec,
      notes: body.notes,
      baseVersionId: body.baseVersionId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkflowConflictError) {
      return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
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

  const service = createServiceClient();
  const { error } = await service
    .from("workflows")
    .update({ archived_at: new Date().toISOString(), enabled: false, updated_by: user.id })
    .eq("id", workflowId)
    .eq("property_id", propertyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Drop any pg_cron schedule for this workflow. Best-effort — failure here
  // just leaves an orphan job that the next sweep would emit into a
  // disabled workflow (which the dispatcher records as filtered_reason).
  await service.rpc("workflows_unschedule_cron", { p_workflow_id: workflowId });

  return NextResponse.json({ ok: true });
}
