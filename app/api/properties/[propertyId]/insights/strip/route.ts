import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { computeScopeStrip } from "@/lib/insights/metrics";

/**
 * GET /api/properties/:propertyId/insights/strip?scope=project:<id>
 *                                              |?scope=space:<id>
 *
 * The ambient header stat strip — task rollup + pace flag (project) or
 * stale-SOP count (space). Any member: this is the same data the scope's
 * own task board already shows, just aggregated.
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
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const scopeParam = request.nextUrl.searchParams.get("scope") ?? "";
  const match = scopeParam.match(/^(project|space):([0-9a-f-]{36})$/);
  if (!match) {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }

  try {
    const strip = await computeScopeStrip(propertyId, {
      kind: match[1] as "project" | "space",
      id: match[2],
    });
    return NextResponse.json(strip);
  } catch (err) {
    console.error("[insights] strip failed", err);
    return NextResponse.json({ error: "strip failed" }, { status: 500 });
  }
}
