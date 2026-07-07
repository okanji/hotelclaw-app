import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCalendarSources,
  getConnections,
} from "@/lib/calendar/queries";

/**
 * `GET /api/me/calendar`
 *
 * Returns the user's calendar connection state (which providers are wired
 * up) and the flattened list of toggleable sources (internal meetings/tasks
 * plus every external calendar) that the section sidebar renders.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const [connections, sources] = await Promise.all([
      getConnections(supabase, user.id),
      getCalendarSources(supabase, user.id),
    ]);
    return NextResponse.json({ connections, sources });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load calendar" },
      { status: 500 },
    );
  }
}
