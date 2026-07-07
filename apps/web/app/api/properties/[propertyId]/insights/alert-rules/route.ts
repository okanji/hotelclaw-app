import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { parseScope } from "@/lib/insights/scope";

/**
 * The caller's threshold alert rules for this property.
 *   GET  → list
 *   POST {scope, metric, threshold} → upsert (unique per user/scope/metric)
 * Owner/manager only; RLS enforces own-row access.
 */

const METRICS = [
  "overdue_count",
  "blocked_count",
  "unassigned_urgent_count",
  "project_at_risk",
] as const;

async function authed(propertyId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 as const };
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || membership.role === "staff") return { error: 403 as const };
  return { supabase, user };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const { data, error } = await auth.supabase
    .from("insight_alert_rules")
    .select("id, scope, metric, threshold, enabled, last_triggered_at")
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

const PostBody = z.object({
  scope: z.string(),
  metric: z.enum(METRICS),
  threshold: z.number().int().min(0).max(999).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const parsed = PostBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parseScope(parsed.data.scope)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { data, error } = await auth.supabase
    .from("insight_alert_rules")
    .upsert(
      {
        user_id: auth.user.id,
        property_id: propertyId,
        scope: parsed.data.scope,
        metric: parsed.data.metric,
        threshold:
          parsed.data.metric === "project_at_risk"
            ? null
            : (parsed.data.threshold ?? 0),
        enabled: true,
      },
      { onConflict: "user_id,property_id,scope,metric" },
    )
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ruleId: data.id });
}
