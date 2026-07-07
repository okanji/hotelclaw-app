import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Members of a property, with profile info merged in.
 *
 * We do this as two queries instead of a Supabase relational join
 * (`profile:profiles!inner(...)`). The relational shorthand requires a foreign
 * key from `memberships` to `profiles`, but our schema's FK goes to
 * `auth.users` — so PostgREST can't auto-resolve the path and returns 500.
 * Two cheap queries + an in-memory merge sidesteps that entirely.
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

  const { data: members, error: membersErr } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("property_id", propertyId);

  if (membersErr) {
    return NextResponse.json({ error: membersErr.message }, { status: 500 });
  }
  if (!members || members.length === 0) {
    return NextResponse.json([]);
  }

  const userIds = members.map((m) => m.user_id);
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", userIds);

  if (profilesErr) {
    return NextResponse.json({ error: profilesErr.message }, { status: 500 });
  }

  const byId = new Map(
    (profiles ?? []).map((p) => [p.id, p] as const),
  );

  const result = members.map((m) => {
    const p = byId.get(m.user_id);
    return {
      id: m.user_id,
      role: m.role,
      name: p?.full_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
    };
  });

  return NextResponse.json(result);
}
