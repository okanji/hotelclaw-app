import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { updateTaskFor } from "@/lib/tasks/mutations";

/**
 * GET /api/properties/:propertyId/tasks/:taskId
 * Returns a single task — used by the Activity detail pane to hydrate
 * `TaskRoom` for a task notification. RLS scopes access.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, assignee_id, due_at, labels, project_name, created_at, updated_at",
    )
    .eq("property_id", propertyId)
    .eq("id", taskId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

/**
 * `PATCH /api/properties/:propertyId/tasks/:taskId` — update a task.
 *
 * Exists for mobile, which cannot call the `updateTask` server action. Runs the
 * SAME `updateTaskFor`, so assignee change notifications and the move-to-top
 * repositioning on a status change behave exactly as they do on web.
 *
 * The taskId comes from the route, and RLS plus an explicit property check stop
 * a caller from patching a task in a property they aren't a member of.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
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

  // RLS already scopes the row, but the route's propertyId must agree with the
  // task's — otherwise a member of property A could address a task by id from
  // property B and get a confusing 400 instead of a 404.
  const { data: owned } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await updateTaskFor(supabase, user.id, {
    ...(body as Record<string, unknown>),
    taskId,
  } as Parameters<typeof updateTaskFor>[2]);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
