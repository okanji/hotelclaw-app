import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FormFill } from "@/components/forms/form-fill";

/**
 * Fill view — the link shared with respondents. Renders the form as a
 * centered page; submission goes through `submitFormResponse`, which
 * re-validates server-side and emits the `form.submitted` workflow event.
 */
export default async function FormFillPage({
  params,
}: {
  params: Promise<{ propertyId: string; formId: string }>;
}) {
  const { propertyId, formId } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title, description, icon, schema, status, allow_multiple, anonymous")
    .eq("id", formId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!form) notFound();

  return (
    <FormFill
      propertyId={propertyId}
      title={form.title}
      description={form.description}
      icon={form.icon}
      formId={form.id}
      schema={form.schema}
      status={form.status}
      allowMultiple={form.allow_multiple}
    />
  );
}
