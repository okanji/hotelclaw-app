import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Mention search for Liveblocks `resolveMentionSuggestions`.
 *
 *   GET /api/users/search?text=<query>&propertyId=<uuid>
 *
 * Returns an array of user ids (strings) for members of `propertyId` whose
 * `profiles.full_name` matches `text` (case-insensitive substring). Empty
 * `text` returns the first batch of members so the picker can show options
 * before the user types anything.
 *
 * Auth: caller must be a signed-in member of `propertyId`. The is_member RPC
 * runs under the caller's JWT (SECURITY DEFINER ensures it can read the
 * memberships table without leaking it through RLS).
 */

const MAX_RESULTS = 8;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const text = request.nextUrl.searchParams.get("text") ?? "";
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  // The membership gate and the roster read are independent — run them
  // concurrently (this fires on every keystroke of the mention typeahead,
  // so one fewer serial DB round trip is felt). The roster is only USED
  // after the gate passes, and it's RLS-guarded regardless.
  //
  // Two queries instead of a relational join: `profiles!inner(...)` from
  // `memberships` 500s because the FK goes to auth.users, not profiles, so
  // PostgREST can't resolve the embed (same reason the members route does
  // this — see app/api/properties/[propertyId]/members/route.ts). This being
  // a join was why @-mention suggestions never returned any members.
  const [
    { data: isMember, error: memberErr },
    { data: members, error: membersErr },
  ] = await Promise.all([
    supabase.rpc("is_member", { prop_id: propertyId }),
    supabase
      .from("memberships")
      .select("user_id")
      .eq("property_id", propertyId)
      .neq("user_id", user.id),
  ]);

  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (membersErr) {
    return NextResponse.json({ error: membersErr.message }, { status: 500 });
  }

  const memberIds = (members ?? [])
    .map((m) => m.user_id as string)
    .filter((id): id is string => !!id);
  if (memberIds.length === 0) {
    return NextResponse.json([]);
  }

  let profileQuery = supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", memberIds)
    .order("full_name", { ascending: true })
    .limit(MAX_RESULTS);

  if (text.trim().length > 0) {
    profileQuery = profileQuery.ilike("full_name", `%${text.trim()}%`);
  }

  const { data: profiles, error } = await profileQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (profiles ?? []).map((p) => p.id as string);
  return NextResponse.json(ids);
}
