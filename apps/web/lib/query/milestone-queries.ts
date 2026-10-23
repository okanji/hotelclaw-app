import { queryOptions } from "@tanstack/react-query";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { EntityColor } from "@/lib/db/types";

/** One `project_milestones` row (migration 0106). `due_date` is `YYYY-MM-DD`. */
export type Milestone = {
  id: string;
  property_id: string;
  project_id: string;
  name: string;
  due_date: string;
  completed_at: string | null;
  position: number;
};

/** A milestone with its project's identity, for cross-project lanes. */
export type PropertyMilestone = Milestone & {
  project: { id: string; name: string; color: EntityColor } | null;
};

const COLS =
  "id, property_id, project_id, name, due_date, completed_at, position";

export function projectMilestonesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["milestones", "project", projectId] as const,
    queryFn: async (): Promise<Milestone[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("project_milestones")
        .select(COLS)
        .eq("project_id", projectId)
        .order("due_date", { ascending: true })
        .order("position", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Milestone[];
    },
  });
}

/**
 * Every milestone across the property's live projects — the board timeline's
 * milestone lane. Archived projects' milestones are left out.
 */
export function propertyMilestonesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["milestones", "property", propertyId] as const,
    queryFn: async (): Promise<PropertyMilestone[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("project_milestones")
        .select(`${COLS}, project:projects!inner(id, name, color, archived_at)`)
        .eq("property_id", propertyId)
        .is("project.archived_at", null)
        .order("due_date", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as (Milestone & {
        project: { id: string; name: string; color: EntityColor } | null;
      })[]).map((r) => ({ ...r, project: r.project ?? null }));
    },
  });
}
