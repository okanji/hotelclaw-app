import { NextResponse, type NextRequest } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getNotifications } from "@/lib/notifications/server";

/**
 * GET /api/me/notifications
 *   - Returns the current user's latest notifications (default 50).
 *   - `?unseen=1` to only return unseen rows.
 *
 * Read goes through the user-scoped client; RLS scopes by user_id.
 */
export async function GET(request: NextRequest) {
  // Cookie OR Bearer (mobile): both run as the user, so RLS scopes rows.
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const unseenOnly = request.nextUrl.searchParams.get("unseen") === "1";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);

  try {
    return NextResponse.json(
      await getNotifications(supabase, { limit, unseenOnly }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load notifications" },
      { status: 500 },
    );
  }
}
