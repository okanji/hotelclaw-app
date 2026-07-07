import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateInsightsBrief } from "@/lib/ai/bots/insights-bot";
import { evaluateAlertRules } from "@/lib/insights/alerts";

// Vercel Cron — daily 05:30 UTC (see vercel.json). Refreshes each active
// property's intelligence brief so the first manager of the morning opens a
// current page instead of paying revalidation latency. The fingerprint
// check inside generateInsightsBrief makes quiet properties free: no number
// moved → no model call.

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
    .select("id");
  if (error) {
    console.error("[briefs-cron] properties query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const results: { propertyId: string; status: string }[] = [];
  for (const property of properties ?? []) {
    try {
      // User-defined threshold rules run before the quiet-skip — rules are
      // cheap (one metrics pass per distinct rule scope) and a "quiet"
      // property can still be sitting on overdue work someone alerts on.
      try {
        await evaluateAlertRules(property.id);
      } catch (err) {
        console.error("[briefs-cron] alert rules failed", property.id, err);
      }

      const { count } = await supabase
        .from("workflow_events")
        .select("id", { count: "exact", head: true })
        .eq("property_id", property.id)
        .gte("received_at", since);
      if ((count ?? 0) < MIN_WEEKLY_EVENTS) {
        results.push({ propertyId: property.id, status: "skipped_quiet" });
        continue;
      }
      const { cached } = await generateInsightsBrief({
        propertyId: property.id,
      });
      results.push({
        propertyId: property.id,
        status: cached ? "already_current" : "regenerated",
      });
    } catch (err) {
      console.error("[briefs-cron] brief failed", property.id, err);
      results.push({ propertyId: property.id, status: "failed" });
    }
  }
  return NextResponse.json({ results });
}
