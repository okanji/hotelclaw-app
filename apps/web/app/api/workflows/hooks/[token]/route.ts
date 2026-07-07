import { NextResponse, type NextRequest } from "next/server";
import { resumeHook } from "workflow/api";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

// POST /api/workflows/hooks/[token]
//
// Resumes a durable workflow run that's paused on `control.wait_for_event`.
// The token format is `wf:<workflowId>:<runId>:<stepId>` (deterministic so
// external systems can build it). We extract `workflowId` from the token,
// confirm the caller is a member of that workflow's property, then resume.
//
// v1 is human-driven (you manually POST when the awaited thing happens).
// v1.1 will plumb this in the dispatcher: when a workflow_event matches a
// step's wait correlator, the dispatcher auto-resumes.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const decoded = decodeURIComponent(token);

  // Token shape: "wf:<workflowId>:<runId>:<stepId>"
  if (!decoded.startsWith("wf:")) {
    return NextResponse.json({ error: "malformed token" }, { status: 400 });
  }
  const parts = decoded.split(":");
  if (parts.length < 4) {
    return NextResponse.json({ error: "malformed token" }, { status: 400 });
  }
  const workflowId = parts[1];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: workflow } = await supabase
    .from("workflows")
    .select("id, property_id")
    .eq("id", workflowId)
    .maybeSingle();
  if (!workflow) return NextResponse.json({ error: "not found" }, { status: 404 });

  const membership = await getMembershipForProperty(workflow.property_id);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  try {
    await resumeHook(decoded, payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "resume failed" },
      { status: 500 },
    );
  }
}
