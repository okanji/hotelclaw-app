import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_COLUMNS } from "@/lib/tasks/list-columns";
import type { TaskViewColumn, TaskViewSort } from "@/lib/db/types";

/**
 * The signed-in user's list-view layout for a property (migration 0099).
 * Column layout is a personal preference, so there is exactly one row per
 * (user, property, view) and RLS scopes reads to the owner — no filtering by
 * user id is needed here.
 */

export const TASKS_LIST_VIEW_KEY = "tasks:list";

export type TaskViewLayout = {
  columns: TaskViewColumn[];
  sort: TaskViewSort;
};

export function taskViewLayoutQueryOptions(
  propertyId: string,
  viewKey: string = TASKS_LIST_VIEW_KEY,
) {
  return queryOptions({
    queryKey: ["task-view-layout", propertyId, viewKey] as const,
    queryFn: async (): Promise<TaskViewLayout> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("task_view_columns")
        .select("columns, sort")
        .eq("property_id", propertyId)
        .eq("view_key", viewKey)
        .maybeSingle();
      if (error) throw new Error(error.message);
      // No saved row is the common case, not an error — everyone starts on
      // the default column set.
      if (!data) return { columns: DEFAULT_COLUMNS, sort: null };
      return {
        columns:
          Array.isArray(data.columns) && data.columns.length > 0
            ? data.columns
            : DEFAULT_COLUMNS,
        sort: data.sort ?? null,
      };
    },
    staleTime: 60_000,
  });
}
