import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { saveWorkflow } from "@/lib/workflows/save";

// GET  — list this workflow's saved versions (newest first), flagging current.
// POST — restore a prior version: re-saves its spec as a new current version,
//        so history is preserved (restore is forward-only, never destructive).

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; workflowId: string }> },
) {
  const { propertyId, workflowId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await createClient();
  // Confirm the workflow belongs to this property and get its current version.
  const { data: workflow } = await supabase
    .from("workflows")
    .select("id, current_version_id")
    .eq("id", workflowId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!workflow) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: versions, error } = await supabase
    .from("workflow_versions")
    .select("id, version, notes, created_at")
    .eq("workflow_id", workflowId)
    .order("version", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    versions: (versions ?? []).map((v) => ({
      ...v,
      is_current: v.id === workflow.current_version_id,
    })),
  });
}

const RestoreBody = z.object({ version: z.number().int().positive() });

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

  let body: z.infer<typeof RestoreBody>;
  try {
    body = RestoreBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: version } = await service
    .from("workflow_versions")
    .select("spec")
    .eq("workflow_id", workflowId)
    .eq("version", body.version)
    .maybeSingle();
  if (!version) return NextResponse.json({ error: "version not found" }, { status: 404 });

  try {
    const result = await saveWorkflow({
      workflowId,
      propertyId,
      userId: user.id,
      spec: version.spec,
      notes: `Restored from version ${body.version}`,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
