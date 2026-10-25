import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getTriageQueue } from "@/lib/tasks/triage-queue";
import { createTaskFor } from "@/lib/tasks/mutations";

/**
 * `GET /api/properties/:propertyId/triage[?spaceId=]` — the pending queue.
 * `POST` — file a task straight into triage (mobile's "Submit to triage";
 * web uses the `submitToTriage` action). Cookie OR Bearer via
 * `resolveApiCaller`; RLS on the caller's client is the tenancy gate.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const spaceId = new URL(request.url).searchParams.get("spaceId");
  try {
    return NextResponse.json(
      await getTriageQueue(supabase, propertyId, { spaceId }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load triage" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const result = await createTaskFor(supabase, user.id, {
    ...(body as Record<string, unknown>),
    propertyId,
    triage: true,
  } as Parameters<typeof createTaskFor>[2]);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ taskId: result.taskId }, { status: 201 });
}
