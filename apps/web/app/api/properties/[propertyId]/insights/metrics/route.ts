import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  computeInsightsMetrics,
  computeMyWeek,
  type InsightsMetrics,
  type AttentionItem,
  type MyWeek,
} from "@/lib/insights/metrics";
import { parseScope, PROPERTY_SCOPE } from "@/lib/insights/scope";

/**
 * GET /api/properties/:propertyId/insights/metrics?scope=<key>
 *
 * Role-shaped insights payload. Owners/managers get the full management set
 * (snapshot, flow, attention, cycle time, portfolio, workload), optionally
 * narrowed by `?scope=` to a project / space (team) / person lens; staff get
 * a personal "My Week" slice — own throughput and own attention items only,
 * and the scope param is ignored entirely for them. Peer comparison is
 * structurally absent from the staff response, not prompt- or UI-hidden.
 */

export type InsightsMetricsResponse =
  | ({ role: "owner" | "manager" } & InsightsMetrics)
  | {
      role: "staff";
      myWeek: MyWeek;
      attention: AttentionItem[];
      generatedAt: string;
    };

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
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    if (membership.role === "staff") {
      const { myWeek, attention } = await computeMyWeek(propertyId, user.id);
      const body: InsightsMetricsResponse = {
        role: "staff",
        myWeek,
        attention,
        generatedAt: new Date().toISOString(),
      };
      return NextResponse.json(body);
    }
    const scope =
      parseScope(request.nextUrl.searchParams.get("scope")) ?? PROPERTY_SCOPE;
    const metrics = await computeInsightsMetrics(propertyId, scope);
    const body: InsightsMetricsResponse = {
      role: membership.role as "owner" | "manager",
      ...metrics,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[insights] metrics failed", err);
    return NextResponse.json({ error: "metrics failed" }, { status: 500 });
  }
}
