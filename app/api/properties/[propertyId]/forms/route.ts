import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/properties/:propertyId/forms — lightweight form index for the
// Documents-section sidebar. RLS scopes rows to the caller's membership;
// the full list page does its own richer server query.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("forms")
    .select("id, title, icon, status, updated_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
