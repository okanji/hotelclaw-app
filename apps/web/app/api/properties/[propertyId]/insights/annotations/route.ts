import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { annotateAtRiskProjects } from "@/lib/ai/bots/insights-bot";

/**
 * POST /api/properties/:propertyId/insights/annotations
 *
 * One-line Haiku assessments for behind/at-risk portfolio projects. POST
 * because it may trigger generations, but it's idempotent: unchanged
 * rollups return their cached note without touching the model. Owner/manager
 * only (annotations narrate management aggregates).
 */
export async function POST(
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
    const annotations = await annotateAtRiskProjects(propertyId);
    return NextResponse.json({ annotations });
  } catch (err) {
    console.error("[insights] annotations failed", err);
    return NextResponse.json({ error: "annotations failed" }, { status: 500 });
  }
}
