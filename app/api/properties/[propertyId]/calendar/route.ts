import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCalendarEvents } from "@/lib/calendar/queries";

/**
 * `GET /api/properties/:propertyId/calendar?from=…&to=…`
 *
 * Returns every event the grid renders for the window — meetings, scheduled
 * tasks, and the user's connected external events — in a single unified
 * shape. The client-side query is keyed on the rounded `[from, to)` window
 * so a week-flip is a fresh cache entry; React Query's `keepPreviousData`
 * keeps the grid populated during the transition.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to are required ISO timestamps" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const events = await getCalendarEvents(supabase, propertyId, user.id, {
      from,
      to,
    });
    return NextResponse.json(events);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load calendar" },
      { status: 500 },
    );
  }
}
