import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runWorkflowNow } from "@/lib/workflows/dispatcher";

// Public inbound webhook: POST /api/workflows/webhook/[token]
//
// The token is the workflow's unguessable webhook_token (the only auth — no
// login). We look the workflow up by it, confirm it's enabled and actually
// set up for webhook/form triggers, then run its current spec with the posted
// body as the trigger payload (available downstream as {{trigger.*}}).

const WEBHOOK_TRIGGERS = new Set(["webhook.received", "form.submitted"]);

async function readPayload(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  if (contentType.includes("form")) {
    const fd = await request.formData().catch(() => null);
    return fd ? (Object.fromEntries(fd.entries()) as Record<string, unknown>) : {};
  }
  // Last resort: try JSON.
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const service = createServiceClient();

  const { data: workflow } = await service
    .from("workflows")
    .select("id, property_id, enabled, archived_at, current_version_id")
    .eq("webhook_token", token)
    .maybeSingle();
  if (!workflow || workflow.archived_at) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!workflow.enabled) {
    return NextResponse.json({ error: "workflow is disabled" }, { status: 409 });
  }

  // Confirm the workflow is actually webhook/form-triggered (every workflow has
  // a token, but only these should be reachable this way).
  if (!workflow.current_version_id) {
    return NextResponse.json({ error: "workflow has no saved version" }, { status: 409 });
  }
  const { data: version } = await service
    .from("workflow_versions")
    .select("spec")
    .eq("id", workflow.current_version_id)
    .maybeSingle();
  const triggerType = (version?.spec as { trigger?: { event_type?: string } } | undefined)?.trigger
    ?.event_type;
  if (!triggerType || !WEBHOOK_TRIGGERS.has(triggerType)) {
    return NextResponse.json(
      { error: "This workflow isn't set up for webhook triggers." },
      { status: 400 },
    );
  }

  const payload = await readPayload(request);

  try {
    const { runId, status } = await runWorkflowNow({
      workflowId: workflow.id,
      propertyId: workflow.property_id,
      triggerPayload: payload,
    });
    return NextResponse.json({ ok: true, runId, status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "run failed" },
      { status: 500 },
    );
  }
}

// Some providers ping with GET to verify the URL is live.
export async function GET() {
  return NextResponse.json({ ok: true, message: "Workflow webhook endpoint. POST to trigger." });
}
