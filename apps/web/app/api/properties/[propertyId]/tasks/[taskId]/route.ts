import { assigneeIdsFromEmbed } from "@/lib/tasks/assignees";
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
      // 0114: list / status ids + the status row flattened (status_name,
      // status_category, status_color, status_blocked), same as getTasks.
      "id, title, description, status, priority, assignee_id, created_by, due_at, scheduled_start, scheduled_end, labels, project_name, space_id, project_id, parent_id, recurrence, source, created_at, updated_at, estimate, cycle_id, milestone_id, triage_state, list_id, status_id, completed_at, checklist_total, checklist_done, status_ref:statuses!tasks_status_id_fkey(name, category, color, is_blocked), task_assignees(user_id, position, created_at)",
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
  // The embed is typed by hand (Relationships: [] in lib/db/types.ts).
  const { status_ref, task_assignees, ...task } = data as typeof data & {
    task_assignees: { user_id: string; position: number; created_at: string }[] | null;
    status_ref: { name: string; category: string; color: string; is_blocked: boolean } | null;
  };
  return NextResponse.json({
    ...task,
    assignee_ids: assigneeIdsFromEmbed(task_assignees),
    status_name: status_ref?.name ?? null,
    status_category: status_ref?.category ?? null,
    status_color: status_ref?.color ?? null,
    status_blocked: status_ref?.is_blocked ?? null,
  });
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
