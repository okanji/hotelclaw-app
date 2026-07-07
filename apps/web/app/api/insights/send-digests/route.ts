import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateInsightsBrief, scopeLabel } from "@/lib/ai/bots/insights-bot";
import { sendDigestEmail } from "@/lib/email/send-insight-email";
import { parseScope } from "@/lib/insights/scope";
import { getOrigin } from "@/lib/utils/origin";
import type { InsightCard } from "@/lib/ai/bots/insights-bot";

// Vercel Cron — daily 07:30 UTC (after refresh-briefs at 05:30 and Monday's
// weekly report at 07:00). Delivery is rendering: daily follows render the
// cached brief for their lens (generateInsightsBrief's fingerprint makes a
// fresh-enough cache free), weekly follows render the week's management
// report headline. Idempotency lives in the send layer (insight_email_log +
// Resend idempotency keys), so retries are safe.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const isMonday = new Date().getUTCDay() === 1;
  const today = new Date().toISOString().slice(0, 10);
  const origin = await getOrigin();

  const { data: follows, error } = await supabase
    .from("insight_follows")
    .select("id, user_id, property_id, scope, cadence");
  if (error) {
    console.error("[send-digests] follows query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const propertyNames = new Map<string, string>();
  async function propertyName(id: string): Promise<string> {
    if (propertyNames.has(id)) return propertyNames.get(id)!;
    const { data } = await supabase
      .from("properties")
      .select("name")
      .eq("id", id)
      .maybeSingle();
    const name = data?.name ?? "Your property";
    propertyNames.set(id, name);
    return name;
  }

  const results: { followId: string; status: string }[] = [];
  for (const follow of follows ?? []) {
    try {
      if (follow.cadence === "weekly" && !isMonday) {
        results.push({ followId: follow.id, status: "not_due" });
        continue;
      }
      const scope = parseScope(follow.scope);
      if (!scope) {
        results.push({ followId: follow.id, status: "bad_scope" });
        continue;
      }
      const name = await propertyName(follow.property_id);
      const insightsUrl = `${origin}/p/${follow.property_id}/insights`;

      if (follow.cadence === "weekly" && scope.kind === "property") {
        // Weekly property follow → this week's management report headline.
        const { data: report } = await supabase
          .from("insight_reports")
          .select("period_start, period_end, summary_md")
          .eq("property_id", follow.property_id)
          .eq("audience", "management")
          .order("period_start", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!report) {
          results.push({ followId: follow.id, status: "no_report" });
          continue;
        }
        const headline = extractHeadline(report.summary_md ?? "");
        const sent = await sendDigestEmail({
          userId: follow.user_id,
          propertyId: follow.property_id,
          propertyName: name,
          lensLabel: "the whole property",
          cadence: "weekly",
          dedupeKey: `digest-weekly/${follow.id}/${report.period_start}`,
          summary: headline,
          cards: [],
          insightsUrl: `${insightsUrl}/reports`,
        });
        results.push({ followId: follow.id, status: sent.reason ?? sent.status });
        continue;
      }

      // Daily (or weekly non-property) follow → the lens's cached brief.
      const { brief } = await generateInsightsBrief({
        propertyId: follow.property_id,
        scope,
      });
      if (!brief || !brief.insights || brief.insights.length === 0) {
        results.push({ followId: follow.id, status: "no_brief" });
        continue;
      }
      const sent = await sendDigestEmail({
        userId: follow.user_id,
        propertyId: follow.property_id,
        propertyName: name,
        lensLabel: await scopeLabel(follow.property_id, scope),
        cadence: follow.cadence as "daily" | "weekly",
        dedupeKey: `digest-${follow.cadence}/${follow.id}/${today}`,
        summary: brief.summary,
        cards: brief.insights as InsightCard[],
        insightsUrl,
      });
      results.push({ followId: follow.id, status: sent.reason ?? sent.status });
    } catch (err) {
      console.error("[send-digests] follow failed", follow.id, err);
      results.push({ followId: follow.id, status: "failed" });
    }
  }

  return NextResponse.json({ results });
}

/** First ~240 chars of the report's Headline section. */
function extractHeadline(md: string): string {
  const match = md.match(/##\s*Headline[^\n]*\n+([\s\S]*?)(?=\n##|$)/i);
  const text = (match?.[1] ?? md).replace(/[#*_>`]/g, "").trim();
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}
