import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; workflowId: string; runId: string }> },
) {
  const { propertyId, workflowId, runId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", runId)
    .eq("workflow_id", workflowId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: steps } = await supabase
    .from("workflow_step_runs")
    .select("*")
    .eq("run_id", runId)
    .order("started_at", { ascending: true });

  return NextResponse.json({ run, steps: steps ?? [] });
}
