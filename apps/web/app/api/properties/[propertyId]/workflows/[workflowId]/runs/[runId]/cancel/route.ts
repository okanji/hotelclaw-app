import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

// Cancel an in-flight run. Pragmatic, DB-level: marks the run `cancelled` and
// disposes any pending waits so a waiting run stops being resumable (the common
// "stuck on wait_for_event" case). A durable run actively mid-step isn't force-
// killed — the SDK doesn't expose that here — but a waiting/queued run is fully
// stopped, and instant runs are synchronous so are never cancellable anyway.

const ACTIVE = ["running", "waiting", "queued"] as const;
const isActive = (s: string) => (ACTIVE as readonly string[]).includes(s);

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; workflowId: string; runId: string }> },
) {
  const { propertyId, workflowId, runId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const service = createServiceClient();
  const { data: run } = await service
    .from("workflow_runs")
    .select("id, status")
    .eq("id", runId)
    .eq("workflow_id", workflowId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isActive(run.status)) {
    return NextResponse.json(
      { error: `Run is already ${run.status} — nothing to cancel.` },
      { status: 409 },
    );
  }

  const { error: updateErr } = await service
    .from("workflow_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", runId)
    // Guard against a race with the runtime finalizing the run between our read
    // and write — only cancel if it's still active.
    .in("status", ACTIVE);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Drop any pending waits so a matching event can't resume this run.
  await service.from("workflow_waits").delete().eq("run_id", runId);

  return NextResponse.json({ ok: true, status: "cancelled" });
}
