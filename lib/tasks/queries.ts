import "server-only";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Every task for a property, board-ordered (position asc, then newest).
 *
 * Shared by `GET /api/properties/[propertyId]/tasks` and the server-side
 * prefetch in `tasks/page.tsx`, so the route and the prefetch return the
 * exact same shape under the `["tasks", propertyId]` query key.
 */
export async function getTasks(supabase: ServerClient, propertyId: string) {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, assignee_id, created_by, due_at, scheduled_start, scheduled_end, position, parent_id, labels, project_name, team_id, project_id, created_at, updated_at",
    )
    .eq("property_id", propertyId)
    .order("position", { ascending: true })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
