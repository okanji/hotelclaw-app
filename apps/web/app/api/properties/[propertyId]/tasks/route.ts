import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getTasks } from "@/lib/tasks/queries";
import { createTaskFor } from "@/lib/tasks/mutations";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getTasks(supabase, propertyId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load tasks" },
      { status: 500 },
    );
  }
}

/**
 * `POST /api/properties/:propertyId/tasks` — create a task.
 *
 * Exists for mobile, which cannot call the `createTask` server action. It runs
 * the SAME `createTaskFor` the action does, so assignment notifications,
 * background triage, and top-of-column positioning happen identically. The
 * propertyId comes from the route, never the body, and the write runs under
 * the caller's own RLS.
 */
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
  } as Parameters<typeof createTaskFor>[2]);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ taskId: result.taskId }, { status: 201 });
}
