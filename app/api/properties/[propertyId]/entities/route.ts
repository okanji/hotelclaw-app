import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

// GET /api/properties/:propertyId/entities?type=<name>&limit=<n>
//   — list entities of a given type name
// POST /api/properties/:propertyId/entities
//   — create a new entity. Pass { type: <name>, data: <object> }.

const CreateBody = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const typeName = url.searchParams.get("type");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);

  const supabase = await createClient();
  let query = supabase
    .from("entities")
    .select(
      "id, entity_type_id, data, created_at, updated_at, entity_types!inner(name, display_name)",
    )
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (typeName) {
    query = query.eq("entity_types.name", typeName);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entities: data ?? [] });
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
  const { data: type } = await service
    .from("entity_types")
    .select("id")
    .eq("property_id", propertyId)
    .eq("name", body.type)
    .maybeSingle();
  if (!type) return NextResponse.json({ error: `unknown entity type ${body.type}` }, { status: 404 });

  const { data, error } = await service
    .from("entities")
    .insert({
      property_id: propertyId,
      entity_type_id: type.id,
      data: body.data,
      created_by: user.id,
    })
    .select("id, data, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
