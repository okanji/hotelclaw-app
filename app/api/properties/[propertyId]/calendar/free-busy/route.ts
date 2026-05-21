import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * `GET /api/properties/:propertyId/calendar/free-busy?users=…&from=…&to=…`
 *
 * Returns (user_id, start, end, busy) tuples for the requested users
 * across the window. Goes through the `calendar_free_busy` SECURITY
 * DEFINER function so we can see across users' connections without
 * exposing event content. The function re-checks property membership;
 * we still validate the request shape here.
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

  const { searchParams } = new URL(request.url);
  const usersCsv = searchParams.get("users");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!usersCsv || !from || !to) {
    return NextResponse.json(
      { error: "users, from, to are required" },
      { status: 400 },
    );
  }
  const userIds = usersCsv.split(",").filter(Boolean);
  if (userIds.length === 0) return NextResponse.json([]);

  const { data, error } = await supabase.rpc("calendar_free_busy", {
    user_ids: userIds,
    from_ts: from,
    to_ts: to,
    property_id: propertyId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
