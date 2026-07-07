import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getMembershipForProperty } from "@/lib/auth/session";
import { FormDetail, type FormRow } from "@/components/forms/form-detail";

/**
 * Form detail — builder, responses, and settings. Edit rights mirror the
 * RLS update policy: the creator, or any owner/manager.
 */
export default async function FormDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string; formId: string }>;
}) {
  const { propertyId, formId } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select(
      "id, property_id, title, description, icon, schema, status, allow_multiple, anonymous, created_by, created_at, updated_at",
    )
    .eq("id", formId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!form) notFound();

  const user = await getSessionUser();
  const membership = await getMembershipForProperty(propertyId);
  const canEdit =
    form.created_by === user?.id ||
    membership?.role === "owner" ||
    membership?.role === "manager";

  return (
    <FormDetail
      propertyId={propertyId}
      form={form as FormRow}
      canEdit={canEdit}
    />
  );
}
