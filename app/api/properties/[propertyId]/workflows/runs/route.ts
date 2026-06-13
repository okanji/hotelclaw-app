import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

// GET /api/properties/:propertyId/workflows/runs
// Property-wide run log across every workflow. Joins `workflows` for the name
// so the all-runs view can label each row without a second round-trip. RLS
// (workflow_runs_member) already scopes rows to members of the property.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 200);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_runs")
    .select(
      "id, workflow_id, status, mode, trigger_kind, is_dry_run, started_at, finished_at, error, workflows(name)",
    )
    .eq("property_id", propertyId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const runs = (data ?? []).map((r) => {
    const { workflows, ...rest } = r as typeof r & { workflows: { name: string } | null };
    return { ...rest, workflow_name: workflows?.name ?? "Untitled workflow" };
  });
  return NextResponse.json({ runs });
}
