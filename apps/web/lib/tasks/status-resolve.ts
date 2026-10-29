import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  isUuid,
  resolveStatusInput,
  type StatusRow,
} from "@/lib/tasks/statuses";

type Db = SupabaseClient<Database>;

const LEGACY = new Set(["todo", "in_progress", "blocked", "done"]);

/**
 * Server-side status resolution for writers that receive a status as TEXT
 * (workflow steps, the Actions MCP, the AI tools): a uuid, a status NAME of
 * the task's pipeline, or a legacy literal. Pure name matching lives in
 * `resolveStatusInput`; this loads the right pipeline.
 */
export async function statusesOfList(
  db: Db,
  listId: string,
): Promise<StatusRow[]> {
  const { data: list } = await db
    .from("lists")
    .select("status_set_id")
    .eq("id", listId)
    .maybeSingle();
  if (!list) return [];
  const { data } = await db
    .from("statuses")
    .select(
      "id, status_set_id, property_id, name, category, is_blocked, color, position, archived_at",
    )
    .eq("status_set_id", list.status_set_id)
    .is("archived_at", null)
    .order("position", { ascending: true });
  return (data ?? []) as StatusRow[];
}

export type StatusWritePatch =
  | { status_id: string }
  | { status: "todo" | "in_progress" | "blocked" | "done" };

/**
 * The column + value a writer should put on the task row for `input`:
 * `{status_id}` when it names a status of the task's list (uuid or name),
 * `{status}` when it is a legacy literal (the DB resolver maps it), or
 * `undefined` when nothing matches — callers answer with the valid names.
 */
export async function statusPatchForTask(
  db: Db,
  taskId: string,
  input: string,
): Promise<{ patch?: StatusWritePatch; names: string[] }> {
  const q = input.trim();
  const { data: task } = await db
    .from("tasks")
    .select("list_id")
    .eq("id", taskId)
    .maybeSingle();
  const set = task?.list_id ? await statusesOfList(db, task.list_id) : [];
  const names = set.map((s) => s.name);
  if (!q) return { names };
  const row = resolveStatusInput(set, q);
  if (row) return { patch: { status_id: row.id }, names };
  if (isUuid(q)) return { patch: { status_id: q }, names };
  if (LEGACY.has(q.toLowerCase())) {
    return {
      patch: { status: q.toLowerCase() as "todo" | "in_progress" | "blocked" | "done" },
      names,
    };
  }
  return { names };
}
