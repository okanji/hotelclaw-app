import { queryOptions } from "@tanstack/react-query";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { EntityColor, ProjectStatus, TaskStatus } from "@/lib/db/types";

/**
 * React Query options for Spaces + Projects. Both fetch directly via the browser
 * Supabase client (RLS scopes rows to property members). Shared by the Home
 * sidebar and the Spaces/Projects surfaces. A Space is the primary department
 * container (formerly "Team"); a Project is a cross-Space initiative.
 */

export type SpaceRow = {
  id: string;
  property_id: string;
  name: string;
  color: EntityColor;
  icon: string | null;
  position: number;
};

export type ProjectRow = {
  id: string;
  property_id: string;
  name: string;
  description: string | null;
  color: EntityColor;
  icon: string | null;
  status: ProjectStatus;
  start_date: string | null;
  target_date: string | null;
  position: number;
};

/** A soft-deleted project or space, as listed in the archive. */
export type ArchivedEntity = {
  id: string;
  name: string;
  color: EntityColor;
  icon: string | null;
  archived_at: string | null;
};

export type ArchivedItems = {
  projects: ArchivedEntity[];
  spaces: ArchivedEntity[];
};

/**
 * Everything that has been archived (soft-deleted) for a property — projects
 * and spaces with a non-null `archived_at`, newest first. Backs the Archive
 * page, where items can be restored or permanently deleted.
 */
export function archivedQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["archived", propertyId] as const,
    queryFn: async (): Promise<ArchivedItems> => {
      const supabase = createBrowserClient();
      const cols = "id, name, color, icon, archived_at";
      const [proj, sp] = await Promise.all([
        supabase
          .from("projects")
          .select(cols)
          .eq("property_id", propertyId)
          .not("archived_at", "is", null)
          .order("archived_at", { ascending: false }),
        supabase
          .from("spaces")
          .select(cols)
          .eq("property_id", propertyId)
          .not("archived_at", "is", null)
          .order("archived_at", { ascending: false }),
      ]);
      if (proj.error) throw new Error(proj.error.message);
      if (sp.error) throw new Error(sp.error.message);
      return {
        projects: (proj.data ?? []) as ArchivedEntity[],
        spaces: (sp.data ?? []) as ArchivedEntity[],
      };
    },
  });
}

export function spacesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["spaces", propertyId] as const,
    queryFn: async (): Promise<SpaceRow[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("spaces")
        .select("id, property_id, name, color, icon, position")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as SpaceRow[];
    },
  });
}

/**
 * Which teams (spaces) each project involves — one row per (project, space)
 * across the whole property. Feeds the "Teams" chips on the projects
 * overview views.
 */
export function projectSpacesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["project-spaces", propertyId] as const,
    queryFn: async (): Promise<{ project_id: string; space_id: string }[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("project_spaces")
        .select("project_id, space_id, projects!inner(property_id)")
        .eq("projects.property_id", propertyId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        project_id: r.project_id,
        space_id: r.space_id,
      }));
    },
    staleTime: 60_000,
  });
}

/** User ids belonging to a space (mapped against property members for names). */
export function spaceMemberIdsQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: ["space-members", spaceId] as const,
    queryFn: async (): Promise<string[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("space_members")
        .select("user_id")
        .eq("space_id", spaceId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.user_id);
    },
  });
}

export function projectsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["projects", propertyId] as const,
    queryFn: async (): Promise<ProjectRow[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id, property_id, name, description, color, icon, status, start_date, target_date, position",
        )
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectRow[];
    },
  });
}

/**
 * A project enriched with the roll-up of its tasks — the unit the projects
 * tracking views (board / table / timeline) render. `counts` is per-status,
 * `done`/`total` drive the completion bar, and `contributorIds` are the
 * distinct task assignees (mapped to member avatars by the views).
 */
export type ProjectTracking = ProjectRow & {
  counts: Record<TaskStatus, number>;
  total: number;
  done: number;
  contributorIds: string[];
};

const EMPTY_COUNTS = (): Record<TaskStatus, number> => ({
  todo: 0,
  in_progress: 0,
  blocked: 0,
  done: 0,
});

/**
 * Projects for a property, each rolled up with its task counts/progress and
 * contributors. One projects select + one tasks select (project-scoped),
 * aggregated client-side, so the tracking surface needs a single query.
 */
export function projectsTrackingQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["projects-tracking", propertyId] as const,
    queryFn: async (): Promise<ProjectTracking[]> => {
      const supabase = createBrowserClient();
      const [projRes, taskRes] = await Promise.all([
        supabase
          .from("projects")
          .select(
            "id, property_id, name, description, color, icon, status, start_date, target_date, position",
          )
          .eq("property_id", propertyId)
          .is("archived_at", null)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("tasks")
          .select("project_id, status, assignee_id")
          .eq("property_id", propertyId)
          .not("project_id", "is", null),
      ]);
      if (projRes.error) throw new Error(projRes.error.message);
      if (taskRes.error) throw new Error(taskRes.error.message);

      const projects = (projRes.data ?? []) as ProjectRow[];
      const tasks = (taskRes.data ?? []) as {
        project_id: string;
        status: TaskStatus;
        assignee_id: string | null;
      }[];

      const byId = new Map<string, ProjectTracking>();
      const contributorSets = new Map<string, Set<string>>();
      for (const p of projects) {
        byId.set(p.id, {
          ...p,
          counts: EMPTY_COUNTS(),
          total: 0,
          done: 0,
          contributorIds: [],
        });
        contributorSets.set(p.id, new Set());
      }

      for (const t of tasks) {
        const agg = byId.get(t.project_id);
        if (!agg) continue;
        agg.counts[t.status] += 1;
        agg.total += 1;
        if (t.status === "done") agg.done += 1;
        if (t.assignee_id) {
          const set = contributorSets.get(t.project_id)!;
          if (!set.has(t.assignee_id)) {
            set.add(t.assignee_id);
            agg.contributorIds.push(t.assignee_id);
          }
        }
      }

      return projects.map((p) => byId.get(p.id)!);
    },
  });
}
