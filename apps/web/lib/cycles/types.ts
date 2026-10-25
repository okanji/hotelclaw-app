import type { Database, TaskPriority, TaskStatus } from "@/lib/db/types";

/** Client-safe row shapes shared by the cycles server loaders and UI. */
export type CycleRow = Database["public"]["Tables"]["cycles"]["Row"];
export type CycleSettingsRow =
  Database["public"]["Tables"]["cycle_settings"]["Row"];

/** The task columns every cycles surface renders + measures. */
export type CycleTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimate: number | null;
  cycle_id: string | null;
  assignee_id: string | null;
  labels: string[];
  project_id: string | null;
  space_id: string | null;
  due_at: string | null;
  parent_id: string | null;
};
