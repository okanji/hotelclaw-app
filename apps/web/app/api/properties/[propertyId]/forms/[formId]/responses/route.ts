import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { inputFields, parseFormSchema } from "@/lib/forms/schema";
import { resolveLabels } from "@/lib/forms/resolve-options";

// GET /api/properties/:propertyId/forms/:formId/responses — responses for
// the Responses tab, with respondent names merged in. Membership gates the
// route; `form_responses` RLS additionally limits visibility to the form's
// creator, owners/managers, and a respondent's own rows, so a plain staff
// viewer sees only what the policy allows.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; formId: string }> },
) {
  const { propertyId, formId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("form_responses")
    .select("id, respondent_id, answers, source, created_at")
    .eq("form_id", formId)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Two queries instead of a relational join — respondent_id's FK points at
  // auth.users, not profiles, so PostgREST can't resolve the path itself.
  const respondentIds = [
    ...new Set((rows ?? []).map((r) => r.respondent_id).filter((v): v is string => !!v)),
  ];
  const nameById = new Map<string, string | null>();
  if (respondentIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", respondentIds);
    for (const p of profiles ?? []) nameById.set(p.id, p.full_name);
  }

  const responses = (rows ?? []).map((r) => ({
    id: r.id,
    answers: r.answers,
    source: r.source,
    created_at: r.created_at,
    respondent: r.respondent_id
      ? { id: r.respondent_id, name: nameById.get(r.respondent_id) ?? null }
      : null,
  }));

  // Data-connected choice fields store raw ids — batch-resolve them to
  // display labels (one resolveLabels call per sourced field, across all
  // responses) so the client can render names instead of ids.
  const sourcedLabels: Record<string, Record<string, string>> = {};
  const { data: form } = await supabase
    .from("forms")
    .select("schema")
    .eq("id", formId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (form) {
    const schema = parseFormSchema(form.schema);
    for (const field of inputFields(schema)) {
      if (
        (field.type !== "select" && field.type !== "multi_select") ||
        !field.source
      ) {
        continue;
      }
      const ids = new Set<string>();
      for (const r of responses) {
        const value = (r.answers as Record<string, unknown> | null)?.[field.id];
        if (typeof value === "string" && value) {
          ids.add(value);
        } else if (Array.isArray(value)) {
          for (const v of value) if (typeof v === "string" && v) ids.add(v);
        }
      }
      if (ids.size === 0) continue;
      const labels = await resolveLabels(supabase, propertyId, field.source, [
        ...ids,
      ]);
      if (labels.size > 0) sourcedLabels[field.id] = Object.fromEntries(labels);
    }
  }

  return NextResponse.json({ responses, sourcedLabels });
}
