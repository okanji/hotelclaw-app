"use client";

import { useEffect } from "react";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type ChecklistRow = {
  id: string;
  task_id: string;
  name: string;
  position: number;
};

export type ChecklistItemRow = {
  id: string;
  checklist_id: string;
  parent_item_id: string | null;
  text: string;
  done: boolean;
  assignee_id: string | null;
  position: number;
};

export type TaskChecklists = { checklists: ChecklistRow[]; items: ChecklistItemRow[] };

/**
 * One task's checklists + items (0117). Deliberately NOT part of
 * task-detail-meta: that query signs attachment URLs, and a tick must not
 * re-sign every file.
 */
export function taskChecklistsQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: ["task-checklists", taskId] as const,
    queryFn: async (): Promise<TaskChecklists> => {
      const supabase = createClient();
      const [c, i] = await Promise.all([
        supabase
          .from("task_checklists")
          .select("id, task_id, name, position")
          .eq("task_id", taskId)
          .order("position", { ascending: true }),
        supabase
          .from("task_checklist_items")
          .select("id, checklist_id, parent_item_id, text, done, assignee_id, position")
          .eq("task_id", taskId)
          .order("position", { ascending: true }),
      ]);
      if (c.error) throw new Error(c.error.message);
      if (i.error) throw new Error(i.error.message);
      return { checklists: c.data ?? [], items: i.data ?? [] };
    },
    staleTime: 30_000,
  });
}

/**
 * Live checklists: a teammate ticking an item updates this panel, and the
 * board's "3/7" chips (counters live on the task row) via ["tasks", pid].
 */
export function useTaskChecklistsRealtime(propertyId: string, taskId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["task-checklists", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    };
    const channel = supabase
      .channel(`task-checklists-${taskId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_checklists", filter: `task_id=eq.${taskId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_checklist_items", filter: `task_id=eq.${taskId}` },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, taskId, qc]);
}
