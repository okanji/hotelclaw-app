import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePropertyBrain } from "@/lib/brain/client";
import { readBrainPage } from "@/lib/brain/browse";

/**
 * `GET /api/properties/:propertyId/brain/page?slug=…` — one brain page with
 * its tags + timeline, for the Brain browser. Slug arrives as a query param
 * because brain slugs contain slashes (`operations/meetings`).
 *
 * Member-gated; the property-scoped OAuth binding (resolved server-side) is
 * the tenancy wall — brain calls don't go through RLS.
 */
export async function GET(
  request: Request,
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

  const slug = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
  if (!slug || slug.length > 300) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  const binding = await resolvePropertyBrain(propertyId);
  if (!binding) {
    return NextResponse.json({ unavailable: true, reason: "no brain provisioned" });
  }
  const page = await readBrainPage(binding, slug, { propertyId });
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }
  return NextResponse.json({ page });
}
