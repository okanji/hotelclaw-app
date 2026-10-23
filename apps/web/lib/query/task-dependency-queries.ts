import { queryOptions } from "@tanstack/react-query";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

/** `blocker` must finish before `blocked` can start (task_relations.kind = 'blocks'). */
export type TaskDependency = { blocker: string; blocked: string };

/**
 * Every `blocks` relation whose blocker lives in the property — the arrows the
 * Gantt draws. Fenced by the property through the embedded join rather than an
 * `in(...)` over task ids, so a 600-task board doesn't build a 20KB URL.
 */
export function taskDependenciesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["task-dependencies", propertyId] as const,
    queryFn: async (): Promise<TaskDependency[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("task_relations")
        .select("task_id, related_task_id, blocker:tasks!task_id!inner(property_id)")
        .eq("kind", "blocks")
        .eq("blocker.property_id", propertyId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as { task_id: string; related_task_id: string }[]).map(
        (r) => ({ blocker: r.task_id, blocked: r.related_task_id }),
      );
    },
  });
}
