import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { saveWorkflow } from "@/lib/workflows/save";

// GET /api/properties/:propertyId/workflows — list this property's workflows
// POST /api/properties/:propertyId/workflows — create a workflow (optionally with spec)

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  spec: z.unknown().optional(),
  enabled: z.boolean().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .select(
      "id, name, description, enabled, mode, last_run_at, last_run_status, created_at, updated_at",
    )
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workflows: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: created, error: createErr } = await service
    .from("workflows")
    .insert({
      property_id: propertyId,
      name: body.name,
      description: body.description ?? null,
      enabled: body.enabled ?? false,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (createErr || !created) {
    return NextResponse.json({ error: createErr?.message ?? "create failed" }, { status: 500 });
  }

  if (body.spec) {
    try {
      await saveWorkflow({
        workflowId: created.id,
        propertyId,
        userId: user.id,
        spec: body.spec,
      });
    } catch (err) {
      // Roll back the empty workflow if the spec was bad.
      await service.from("workflows").delete().eq("id", created.id);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ id: created.id });
}
