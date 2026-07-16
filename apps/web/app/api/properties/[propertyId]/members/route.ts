import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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

  // Login emails live on auth.users, reachable only via the service client —
  // and only AFTER RLS above has confirmed this user can read the property's
  // roster. Best-effort per member; leave null if the admin API is unavailable.
  const emailById = new Map<string, string>();
  try {
    const service = createServiceClient();
    await Promise.all(
      userIds.map(async (id) => {
        const { data } = await service.auth.admin.getUserById(id);
        if (data.user?.email) emailById.set(id, data.user.email);
      }),
    );
  } catch {
    // Emails are a nicety, not load-bearing — swallow and return names only.
  }

  const result = members.map((m) => {
    const p = byId.get(m.user_id);
    return {
      id: m.user_id,
      role: m.role,
      name: p?.full_name ?? null,
      email: emailById.get(m.user_id) ?? null,
      avatarUrl: p?.avatar_url ?? null,
    };
  });

  return NextResponse.json(result);
}
