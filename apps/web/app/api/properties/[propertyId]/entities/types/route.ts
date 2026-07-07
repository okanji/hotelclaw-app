import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

// GET — list entity types on this property
// POST — create a new entity type
//
// Schemas are stored as JSON (a relaxed JSON Schema). We accept a simple
// "fields" object from the client and translate to a minimal Schema. AI can
// pass a richer schema directly through propose_entity_type.

const FieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "string[]"]),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

const CreateBody = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "use snake_case"),
  display_name: z.string().min(1),
  fields: z.record(z.string(), FieldSchema).optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  display_config: z.record(z.string(), z.unknown()).optional(),
});

function fieldsToJsonSchema(fields: Record<string, z.infer<typeof FieldSchema>>) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, spec] of Object.entries(fields)) {
    let json: Record<string, unknown> = {};
    switch (spec.type) {
      case "string":
        json = { type: "string" };
        break;
      case "number":
        json = { type: "number" };
        break;
      case "boolean":
        json = { type: "boolean" };
        break;
      case "string[]":
        json = { type: "array", items: { type: "string" } };
        break;
    }
    if (spec.description) json.description = spec.description;
    properties[name] = json;
    if (spec.required) required.push(name);
  }
  return { type: "object", properties, required };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entity_types")
    .select("id, name, display_name, schema, display_config, created_at")
    .eq("property_id", propertyId)
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ types: data ?? [] });
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

  const schema =
    body.schema ?? (body.fields ? fieldsToJsonSchema(body.fields) : { type: "object" });

  const service = createServiceClient();
  const { data, error } = await service
    .from("entity_types")
    .insert({
      property_id: propertyId,
      name: body.name,
      display_name: body.display_name,
      schema,
      display_config: body.display_config ?? {},
      created_by: user.id,
    })
    .select("id, name, display_name, schema")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
