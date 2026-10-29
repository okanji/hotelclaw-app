import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { EntityColor, StatusCategory } from "@/lib/db/types";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { assigneeIdsFromEmbed } from "@/lib/tasks/assignees";

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
type StatusEmbed = {
  name: string;
  category: StatusCategory;
  color: EntityColor;
  is_blocked: boolean;
} | null;

export async function getTasks(supabase: ServerClient, propertyId: string) {
  const [tasksRes, propertyRes] = await Promise.all([
    supabase
      .from("tasks")
      // 0114: list_id / status_id / completed_at plus the status row flattened
      // onto the task (status_name, status_category, status_color,
      // status_blocked) so no client needs a second lookup to draw a card.
      .select(
        "id, number, title, description, status, priority, assignee_id, created_by, due_at, scheduled_start, scheduled_end, position, parent_id, labels, project_name, space_id, project_id, recurrence, recurrence_of, source, source_workflow_id, source_workflow_run_id, created_at, updated_at, estimate, cycle_id, milestone_id, triage_state, list_id, status_id, completed_at, checklist_total, checklist_done, status_ref:statuses!tasks_status_id_fkey(name, category, color, is_blocked), task_assignees(user_id, position, created_at)",
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
  return (tasksRes.data ?? []).map((row) => {
    // The embed is typed by hand (Relationships: [] in lib/db/types.ts), so
    // PostgREST's nested object arrives as unknown here.
    const { status_ref, task_assignees, ...t } = row as typeof row & {
      status_ref: StatusEmbed;
      task_assignees: { user_id: string; position: number; created_at: string }[] | null;
    };
    return {
      ...t,
      // 0115: the full set, primary first (`assignee_id` stays the primary).
      assignee_ids: assigneeIdsFromEmbed(task_assignees),
      key: formatTaskKey(prefix, t.number),
      status_name: status_ref?.name ?? null,
      status_category: status_ref?.category ?? null,
      status_color: status_ref?.color ?? null,
      status_blocked: status_ref?.is_blocked ?? null,
    };
  });
}
