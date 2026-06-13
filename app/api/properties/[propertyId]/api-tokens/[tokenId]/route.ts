import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/** DELETE — revoke a token (kept as a row for the audit trail). Owner only. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; tokenId: string }> },
) {
  const { propertyId, tokenId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const service = createServiceClient();
  const { error } = await service
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("property_id", propertyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
