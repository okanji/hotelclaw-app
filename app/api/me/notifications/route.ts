import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/me/notifications
 *   - Returns the current user's latest notifications (default 50).
 *   - `?unseen=1` to only return unseen rows.
 *
 * Read goes through the user-scoped client; RLS scopes by user_id.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const unseenOnly = request.nextUrl.searchParams.get("unseen") === "1";
  const limit = Math.min(
    100,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 50)),
  );

  let q = supabase
    .from("notifications")
    .select("id, type, payload, property_id, seen_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unseenOnly) q = q.is("seen_at", null);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
