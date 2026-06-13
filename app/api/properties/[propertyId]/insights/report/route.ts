import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { generateInsightsReport } from "@/lib/ai/bots/insights-bot";

/**
 * GET  — list this property's insight reports (RLS scopes audience by role).
 * POST — generate (or return the cached) management report for the current
 *        week. Owner/manager only; `force: true` skips the freshness check.
 */

const REPORT_COLUMNS =
  "id, property_id, period_start, period_end, audience, summary_md, anomalies, model, created_at";

export async function GET(
  _request: NextRequest,
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
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // User-scoped client: the RLS policy hides management reports from staff.
  const { data, error } = await supabase
    .from("insight_reports")
    .select(REPORT_COLUMNS)
    .eq("property_id", propertyId)
    .order("period_start", { ascending: false })
    .limit(12);
  if (error) {
    console.error("[insights] reports list failed", error);
    return NextResponse.json({ error: "list failed" }, { status: 500 });
  }
  return NextResponse.json({ reports: data ?? [] });
}

const Body = z.object({ force: z.boolean().optional() });

export async function POST(
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

  let force = false;
  try {
    const raw = await request.json();
    const parsed = Body.safeParse(raw);
    if (parsed.success) force = parsed.data.force ?? false;
  } catch {
    // Empty body is fine — defaults apply.
  }

  try {
    const { report, cached } = await generateInsightsReport({
      propertyId,
      userId: user.id,
      force,
    });
    return NextResponse.json({ report, cached });
  } catch (err) {
    console.error("[insights] report generation failed", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
