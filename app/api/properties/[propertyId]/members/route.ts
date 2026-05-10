import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // RLS on memberships allows reading rows for properties the user is a member of.
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, profile:profiles!inner(id, full_name, avatar_url)")
    .eq("property_id", propertyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    user_id: string;
    role: string;
    profile: { id: string; full_name: string | null; avatar_url: string | null };
  };

  const members = ((data ?? []) as unknown as Row[]).map((m) => ({
    id: m.user_id,
    role: m.role,
    name: m.profile.full_name,
    avatarUrl: m.profile.avatar_url,
  }));

  return NextResponse.json(members);
}
