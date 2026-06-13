import { createClient } from "@/lib/supabase/server";
import { FormsList, type FormListItem } from "@/components/forms/forms-list";

/**
 * Forms index — every form in the property (RLS scopes the tenant; the
 * layout already gated membership). Response counts come from a second
 * cheap query tallied here rather than a PostgREST aggregate, so the count
 * a viewer sees matches what `form_responses` RLS lets them read.
 */
export default async function FormsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();

  const { data: forms } = await supabase
    .from("forms")
    .select(
      "id, title, description, icon, schema, status, allow_multiple, anonymous, created_by, created_at, updated_at",
    )
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const { data: responseRows } = await supabase
    .from("form_responses")
    .select("form_id")
    .eq("property_id", propertyId);

  const counts: Record<string, number> = {};
  for (const row of responseRows ?? []) {
    counts[row.form_id] = (counts[row.form_id] ?? 0) + 1;
  }

  return (
    <FormsList
      propertyId={propertyId}
      forms={(forms ?? []) as FormListItem[]}
      responseCounts={counts}
    />
  );
}
