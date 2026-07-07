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

  const { data: isMember, error: memberErr } = await supabase.rpc("is_member", {
    prop_id: propertyId,
  });
  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Members of the property, optionally filtered by name. We do the filter
  // through the `profiles` join so display names match what the picker shows.
  let query = supabase
    .from("memberships")
    .select("user_id, profiles!inner(id, full_name)")
    .eq("property_id", propertyId)
    .neq("user_id", user.id)
    .limit(MAX_RESULTS);

  if (text.trim().length > 0) {
    // PostgREST embedded-filter syntax for the joined `profiles` row.
    query = query.ilike("profiles.full_name", `%${text}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (data ?? [])
    .map((row) => row.user_id as string)
    .filter((id): id is string => !!id);
  return NextResponse.json(ids);
}
