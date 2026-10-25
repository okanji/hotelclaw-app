import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { ensureAllCycles } from "@/lib/cycles/ensure";
import { localDate } from "@/lib/cycles/dates";
import { cyclePhase } from "@/lib/cycles/plan";

/**
 * `GET /api/properties/:propertyId/cycles` — every cadence + cycle in the
 * property, each cycle tagged with its phase (past / current / upcoming) in
 * the property's own calendar. Feeds `cyclesQueryOptions` (the task-detail
 * cycle picker, the board's Cycle filter, the sidebar's Current / Upcoming).
 *
 * Runs `ensureAllCycles` first, so the first surface to load after a cycle
 * ends is what materialises the next one and rolls open work forward — no
 * cron. Cookie or Bearer (mobile) via `resolveApiCaller`; RLS does tenancy.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const ensured = await ensureAllCycles(supabase, propertyId);
    const [settingsRes, cyclesRes, propertyRes] = await Promise.all([
      supabase
        .from("cycle_settings")
        .select("*")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: true }),
      supabase
        .from("cycles")
        .select("*")
        .eq("property_id", propertyId)
        .order("starts_on", { ascending: true }),
      supabase
        .from("properties")
        .select("timezone")
        .eq("id", propertyId)
        .maybeSingle(),
    ]);
    if (cyclesRes.error) throw new Error(cyclesRes.error.message);
    const timeZone =
      ensured[0]?.timeZone ?? propertyRes.data?.timezone ?? "UTC";
    const today = ensured[0]?.today ?? localDate(new Date(), timeZone);

    return NextResponse.json({
      today,
      timeZone,
      settings: settingsRes.data ?? [],
      cycles: (cyclesRes.data ?? []).map((c) => ({
        ...c,
        phase: cyclePhase(c, today),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load cycles" },
      { status: 500 },
    );
  }
}
