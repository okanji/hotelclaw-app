import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  computeOperationsMetrics,
  type OperationsMetrics,
} from "@/lib/insights/metrics";

/**
 * GET /api/properties/:propertyId/insights/operations
 *
 * Meetings cadence + unowned action items, automation health, the activity
 * heartbeat, and stale pinned SOPs. Owner/manager only; the team-composition
 * extras (role counts, invite funnel) ship only to owners.
 */

export type OperationsResponse = Omit<OperationsMetrics, "team"> & {
  team: OperationsMetrics["team"] | null;
};

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
  if (!membership || membership.role === "staff") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const metrics = await computeOperationsMetrics(propertyId);
    const body: OperationsResponse = {
      ...metrics,
      team: membership.role === "owner" ? metrics.team : null,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[insights] operations failed", err);
    return NextResponse.json({ error: "operations failed" }, { status: 500 });
  }
}
