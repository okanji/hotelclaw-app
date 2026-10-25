import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { formatTaskKey } from "@/lib/tasks/task-key";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Every task for a property, board-ordered (position asc, then newest).
 *
 * Shared by `GET /api/properties/[propertyId]/tasks` and the server-side
 * prefetch in `tasks/page.tsx`, so the route and the prefetch return the
 * exact same shape under the `["tasks", propertyId]` query key. Mobile reads
 * the same route, so changes here stay ADDITIVE.
 *
 * Archived tasks (0108 `archived_at`) are excluded. Each row carries its
 * per-property `number` plus a ready-made human `key`
 * (`<properties.task_prefix>-<number>`, e.g. "GHV-142") so no client needs a
 * second query for the prefix.
 */
export async function getTasks(supabase: ServerClient, propertyId: string) {
  const [tasksRes, propertyRes] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, number, title, description, status, priority, assignee_id, created_by, due_at, scheduled_start, scheduled_end, position, parent_id, labels, project_name, space_id, project_id, recurrence, recurrence_of, source, source_workflow_id, source_workflow_run_id, created_at, updated_at, estimate, cycle_id, milestone_id, triage_state",
      )
      .eq("property_id", propertyId)
      .is("archived_at", null)
      // Triage (0111): pending tasks stay off every board until a person
      // accepts them (the triage queue serves them); declined ones never land.
      .or("triage_state.is.null,triage_state.eq.accepted")
      .order("position", { ascending: true })
      .order("updated_at", { ascending: false }),
    supabase
      .from("properties")
      .select("task_prefix")
      .eq("id", propertyId)
      .maybeSingle(),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  const prefix = propertyRes.data?.task_prefix ?? null;
  return (tasksRes.data ?? []).map((t) => ({
    ...t,
    key: formatTaskKey(prefix, t.number),
  }));
}
