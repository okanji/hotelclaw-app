import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; workflowId: string }> },
) {
  const { propertyId, workflowId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_runs")
    .select(
      "id, status, mode, durable_run_id, trigger_kind, is_dry_run, started_at, finished_at, error",
    )
    .eq("workflow_id", workflowId)
    .eq("property_id", propertyId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
