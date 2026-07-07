import { NextResponse, type NextRequest, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  generateInsightsBrief,
  getCachedBrief,
} from "@/lib/ai/bots/insights-bot";
import { parseScope, PROPERTY_SCOPE } from "@/lib/insights/scope";

/**
 * GET /api/properties/:propertyId/insights/brief?scope=<key>
 *
 * The automatic intelligence brief for a scope (property / project / space /
 * person) — stale-while-revalidate. Returns the cached brief immediately;
 * if the scope's metrics fingerprint has moved on, a regeneration runs in
 * `after()` and the fresh brief reaches open pages via the insight_briefs
 * realtime subscription. First-ever call returns `pending: true` while the
 * background generation fills the cache. Owner/manager only — briefs
 * narrate management aggregates.
 */
export async function GET(
  request: NextRequest,
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
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || membership.role === "staff") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const scope =
      parseScope(request.nextUrl.searchParams.get("scope")) ?? PROPERTY_SCOPE;
    const cached = await getCachedBrief(propertyId, scope);
    // Revalidate in the background — generateInsightsBrief no-ops on a
    // matching fingerprint and dedupes concurrent runs per instance.
    after(async () => {
      try {
        await generateInsightsBrief({ propertyId, scope });
      } catch (err) {
        console.error("[insights] brief revalidation failed", err);
      }
    });
    return NextResponse.json({ brief: cached, pending: cached === null });
  } catch (err) {
    console.error("[insights] brief fetch failed", err);
    return NextResponse.json({ error: "brief failed" }, { status: 500 });
  }
}
