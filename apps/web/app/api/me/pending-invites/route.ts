import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Returns the current user's pending workspace invites — invites where:
 *   - the invite email matches their auth email (case-insensitive)
 *   - not yet accepted
 *   - not yet expired
 *
 * Service-role read because the user-scoped client can't read invite rows
 * for properties they're not yet a member of (RLS).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("invites")
    .select(
      "token, role, expires_at, property_id, property:properties!inner(id, name)",
    )
    .eq("email", user.email.toLowerCase())
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    token: string;
    role: string;
    expires_at: string;
    property_id: string;
    property: { id: string; name: string };
  };

  const items = ((data ?? []) as unknown as Row[]).map((row) => ({
    token: row.token,
    role: row.role,
    propertyId: row.property_id,
    propertyName: row.property.name,
    expiresAt: row.expires_at,
  }));

  return NextResponse.json(items);
}
