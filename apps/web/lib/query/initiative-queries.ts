import { queryOptions } from "@tanstack/react-query";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type {
  EntityColor,
  InitiativeStatus,
  TaskStatus,
  UpdateHealth,
} from "@/lib/db/types";

/**
 * Initiatives + written status updates (migration 0111) — Linear's planning
 * layer above projects. An initiative ("Refresh all guest rooms by Q2") groups
 * several projects many-to-many; a `project_updates` row is a person's health
 * call + note on either a project or an initiative.
 *
 * Query keys (invalidate by prefix):
 *   ["initiatives", propertyId]          — the list (+ linked project ids)
 *   ["initiative", initiativeId]         — one initiative
 *   ["update-health", propertyId]        — latest declared health per entity
 *   ["project-updates", kind, id]        — one entity's updates feed
 */

export type Initiative = {
  id: string;
  property_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: EntityColor;
  status: InitiativeStatus;
  owner_id: string | null;
  lead_space_id: string | null;
  target_date: string | null;
  position: number;
  created_at: string;
  /** Linked project ids, in link order. */
  projectIds: string[];
};

export type UpdateTarget = { kind: "project" | "initiative"; id: string };

export type ProjectUpdate = {
  id: string;
  property_id: string;
  project_id: string | null;
  initiative_id: string | null;
  author_id: string | null;
  health: UpdateHealth;
  body: string;
  created_at: string;
  updated_at: string;
};

/** Latest declared health per project / initiative id. */
export type DeclaredHealthIndex = {
  projects: Record<string, { health: UpdateHealth; at: string }>;
  initiatives: Record<string, { health: UpdateHealth; at: string }>;
};

const COLS =
  "id, property_id, name, description, icon, color, status, owner_id, lead_space_id, target_date, position, created_at";

type InitiativeRow = Omit<Initiative, "projectIds">;

function attachLinks(
  rows: InitiativeRow[],
  links: { initiative_id: string; project_id: string }[],
): Initiative[] {
  const byInitiative = new Map<string, string[]>();
  for (const l of links) {
    const list = byInitiative.get(l.initiative_id);
    if (list) list.push(l.project_id);
    else byInitiative.set(l.initiative_id, [l.project_id]);
  }
  return rows.map((r) => ({ ...r, projectIds: byInitiative.get(r.id) ?? [] }));
}

/**
 * Every live (unarchived) initiative for the property, position-ordered, each
 * with its linked project ids. Also the source for "which initiatives does
 * this project serve" (filter on `projectIds`) and for a sidebar row.
 */
export function initiativesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["initiatives", propertyId] as const,
    queryFn: async (): Promise<Initiative[]> => {
      const supabase = createBrowserClient();
      const [rows, links] = await Promise.all([
        supabase
          .from("initiatives")
          .select(COLS)
          .eq("property_id", propertyId)
          .is("archived_at", null)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("initiative_projects")
          .select("initiative_id, project_id")
          .eq("property_id", propertyId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      if (rows.error) throw new Error(rows.error.message);
      if (links.error) throw new Error(links.error.message);
      return attachLinks((rows.data ?? []) as InitiativeRow[], links.data ?? []);
    },
  });
}

/** One initiative (archived included, so a stale link still resolves). */
export function initiativeQueryOptions(initiativeId: string) {
  return queryOptions({
    queryKey: ["initiative", initiativeId] as const,
    queryFn: async (): Promise<(Initiative & { archived_at: string | null }) | null> => {
      const supabase = createBrowserClient();
      const [row, links] = await Promise.all([
        supabase
          .from("initiatives")
          .select(`${COLS}, archived_at`)
          .eq("id", initiativeId)
          .maybeSingle(),
        supabase
          .from("initiative_projects")
          .select("initiative_id, project_id")
          .eq("initiative_id", initiativeId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      if (row.error) throw new Error(row.error.message);
      if (!row.data) return null;
      const data = row.data as InitiativeRow & { archived_at: string | null };
      return { ...data, projectIds: (links.data ?? []).map((l) => l.project_id) };
    },
  });
}

/**
 * The latest declared health of every project and initiative in the property
 * — one ordered select reduced first-wins, so list pages need no per-row
 * fetch. Bounded: only the newest updates matter.
 */
export function declaredHealthQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["update-health", propertyId] as const,
    queryFn: async (): Promise<DeclaredHealthIndex> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("project_updates")
        .select("project_id, initiative_id, health, created_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      const out: DeclaredHealthIndex = { projects: {}, initiatives: {} };
      for (const r of data ?? []) {
        const entry = { health: r.health as UpdateHealth, at: r.created_at as string };
        if (r.project_id && !out.projects[r.project_id]) out.projects[r.project_id] = entry;
        if (r.initiative_id && !out.initiatives[r.initiative_id])
          out.initiatives[r.initiative_id] = entry;
      }
      return out;
    },
  });
}

/** One project's or initiative's updates, newest first. */
export function projectUpdatesQueryOptions(target: UpdateTarget) {
  return queryOptions({
    queryKey: ["project-updates", target.kind, target.id] as const,
    queryFn: async (): Promise<ProjectUpdate[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("project_updates")
        .select(
          "id, property_id, project_id, initiative_id, author_id, health, body, created_at, updated_at",
        )
        .eq(target.kind === "project" ? "project_id" : "initiative_id", target.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectUpdate[];
    },
  });
}

/**
 * Status of every milestone-tagged task in the property (`tasks.milestone_id`,
 * 0111) — feed it to `milestoneProgress` for "67% of 3" on cross-project
 * surfaces (the projects timeline's diamonds). Project pages derive the same
 * numbers from their own task list instead.
 */
export function milestoneTasksQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["milestone-tasks", propertyId] as const,
    queryFn: async () => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("tasks")
        .select("status, milestone_id")
        .eq("property_id", propertyId)
        .not("milestone_id", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as { status: TaskStatus; milestone_id: string | null }[];
    },
  });
}
