import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { StatusCatalogPayload } from "@/lib/tasks/statuses";

type Db = SupabaseClient<Database>;

/**
 * Everything a client needs to render lists + pipelines for a property, in
 * the exact shape `GET /api/properties/[propertyId]/lists` returns, so the
 * tasks layout prefetch and the route hydrate the same `["status-catalog"]`
 * key (same contract as getTasks / tasksQueryOptions).
 *
 * Archived LISTS are included (tasks in an archived team still point at
 * theirs — the FK is restrict); archived statuses and sets are not. RLS scopes
 * the rows; the caller passes the property to keep the query indexed.
 */
export async function getStatusCatalog(
  supabase: Db,
  propertyId: string,
): Promise<StatusCatalogPayload> {
  const [listsRes, setsRes, statusesRes] = await Promise.all([
    supabase
      .from("lists")
      .select(
        "id, property_id, space_id, name, description, icon, color, position, status_set_id, inherits_statuses, is_default, archived_at",
      )
      .eq("property_id", propertyId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("status_sets")
      .select("id, property_id, name, is_default, archived_at")
      .eq("property_id", propertyId)
      .is("archived_at", null),
    supabase
      .from("statuses")
      .select(
        "id, status_set_id, property_id, name, category, is_blocked, color, position, archived_at",
      )
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("position", { ascending: true }),
  ]);
  if (listsRes.error) throw new Error(listsRes.error.message);
  if (setsRes.error) throw new Error(setsRes.error.message);
  if (statusesRes.error) throw new Error(statusesRes.error.message);
  return {
    lists: listsRes.data ?? [],
    statusSets: setsRes.data ?? [],
    statuses: statusesRes.data ?? [],
  };
}
