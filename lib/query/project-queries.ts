import { queryOptions } from "@tanstack/react-query";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { EntityColor, ProjectStatus } from "@/lib/db/types";

/**
 * React Query options for Teams + Projects. Both fetch directly via the browser
 * Supabase client (RLS scopes rows to property members). Shared by the Home
 * sidebar and the Projects surfaces.
 */

export type TeamRow = {
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

export function teamsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["teams", propertyId] as const,
    queryFn: async (): Promise<TeamRow[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("teams")
        .select("id, property_id, name, color, icon, position")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TeamRow[];
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
