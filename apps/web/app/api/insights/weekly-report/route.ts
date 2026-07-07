import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateInsightsReport } from "@/lib/ai/bots/insights-bot";

// Vercel Cron route — Monday 07:00 UTC (see vercel.json). Generates the
// week's insight reports proactively so managers find Monday's briefing in
// their notifications instead of paying first-viewer generation latency.
// Vercel signs cron calls with the `x-vercel-cron-signature` header; like
// the workflow drain crons we additionally honor CRON_SECRET when set.
//
// Only properties with a pulse get a report: a property with fewer than 5
// task events in the trailing week has nothing to brief about, and skipping
// it keeps cron cost proportional to real usage. The per-week unique row +
// freshness check in generateInsightsReport make re-runs idempotent.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIN_WEEKLY_EVENTS = 5;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, name");
  if (error) {
    console.error("[insights-cron] properties query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const results: { propertyId: string; status: string }[] = [];
  for (const property of properties ?? []) {
    try {
      const { count } = await supabase
        .from("workflow_events")
        .select("id", { count: "exact", head: true })
        .eq("property_id", property.id)
        .gte("received_at", since);
      if ((count ?? 0) < MIN_WEEKLY_EVENTS) {
        results.push({ propertyId: property.id, status: "skipped_quiet" });
        continue;
      }
      // The report row's created_by FK needs a real user — attribute cron
      // runs to the property owner.
      const { data: owner } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("property_id", property.id)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();
      if (!owner) {
        results.push({ propertyId: property.id, status: "skipped_no_owner" });
        continue;
      }
      const { cached } = await generateInsightsReport({
        propertyId: property.id,
        userId: owner.user_id,
      });
      results.push({
        propertyId: property.id,
        status: cached ? "already_current" : "generated",
      });
    } catch (err) {
      console.error("[insights-cron] report failed", property.id, err);
      results.push({ propertyId: property.id, status: "failed" });
    }
  }

  return NextResponse.json({ results });
}
