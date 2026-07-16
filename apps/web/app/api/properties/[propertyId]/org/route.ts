import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { loadOrgChart } from "@/lib/org/queries";

/** The company org chart — teams (with parent/lead), people (with title,
 *  reports-to, home team), and team rosters. Any property member can read it;
 *  RLS scopes the underlying tables. Edits go through the server actions. */
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

  try {
    const org = await loadOrgChart(supabase, propertyId);

    // Login emails live on auth.users — reachable only via the service client,
    // and only AFTER RLS has confirmed this user can see the property's roster
    // (loadOrgChart used the RLS-scoped client above). Best-effort per member.
    try {
      const service = createServiceClient();
      await Promise.all(
        org.people.map(async (p) => {
          const { data } = await service.auth.admin.getUserById(p.id);
          p.email = data.user?.email ?? null;
        }),
      );
    } catch {
      // Emails are a nicety; leave them null if the admin API is unavailable.
    }

    // Per-team open-task load — turns the chart into a live operational
    // surface (each team row links to its board and shows what's on its
    // plate). Open = not done; grouped in-memory (PostgREST has no GROUP BY).
    const { data: openTasks } = await supabase
      .from("tasks")
      .select("space_id")
      .eq("property_id", propertyId)
      .neq("status", "done")
      .not("space_id", "is", null);
    const openTaskCounts: Record<string, number> = {};
    for (const t of openTasks ?? []) {
      const sid = t.space_id as string | null;
      if (sid) openTaskCounts[sid] = (openTaskCounts[sid] ?? 0) + 1;
    }

    return NextResponse.json({ ...org, openTaskCounts });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load org chart" },
      { status: 500 },
    );
  }
}
