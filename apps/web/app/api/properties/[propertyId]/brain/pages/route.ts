import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePropertyBrain } from "@/lib/brain/client";
import { listBrainPages } from "@/lib/brain/browse";

/**
 * `GET /api/properties/:propertyId/brain/pages` — the property brain's page
 * index (most recently updated first), for the Brain browser's list pane.
 * Member-gated like brain/search; tenancy = the server-resolved binding.
 */
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
  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("property_id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const binding = await resolvePropertyBrain(propertyId);
  if (!binding) {
    return NextResponse.json({ unavailable: true, reason: "no brain provisioned" });
  }
  const pages = await listBrainPages(binding, { propertyId });
  if (pages === null) {
    return NextResponse.json({ unavailable: true, reason: "brain unreachable" });
  }
  return NextResponse.json({ pages });
}
