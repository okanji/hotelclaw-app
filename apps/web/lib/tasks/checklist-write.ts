import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { parseChecklistText, type ParsedChecklistLine } from "@/lib/tasks/checklist-progress";

type Db = SupabaseClient<Database>;

/**
 * Find-or-create a named checklist on a task and append items to it (0117).
 * Shared by the panel's "paste a list", the workflow step
 * `action.task.add_checklist` and the internal route. `items` is either
 * parsed lines or raw text ("- [x] Keys\n  - Spare set"). The property fence
 * is explicit so a service client can call it safely.
 */
export async function addChecklistItemsFor(
  db: Db,
  args: {
    propertyId: string;
    taskId: string;
    name: string;
    items: ParsedChecklistLine[] | string[] | string;
  },
): Promise<{ checklistId: string; created: boolean; added: number } | { error: string }> {
  const name = args.name.trim().slice(0, 120) || "Checklist";
  const { data: task } = await db
    .from("tasks")
    .select("id")
    .eq("id", args.taskId)
    .eq("property_id", args.propertyId)
    .maybeSingle();
  if (!task) return { error: "Task not found in this property" };

  const lines: ParsedChecklistLine[] =
    typeof args.items === "string"
      ? parseChecklistText(args.items)
      : args.items.flatMap((i) =>
          typeof i === "string" ? parseChecklistText(i) : [i],
        );

  const { data: existing } = await db
    .from("task_checklists")
    .select("id, name, position")
    .eq("task_id", args.taskId)
    .order("position", { ascending: true });
  let checklist = (existing ?? []).find((c) => c.name.toLowerCase() === name.toLowerCase());
  let created = false;
  if (!checklist) {
    const last = existing?.[existing.length - 1]?.position ?? 0;
    const { data, error } = await db
      .from("task_checklists")
      .insert({ task_id: args.taskId, property_id: args.propertyId, name, position: last + 1024 })
      .select("id, name, position")
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't create the checklist" };
    checklist = data;
    created = true;
  }

  const { data: lastItem } = await db
    .from("task_checklist_items")
    .select("position")
    .eq("checklist_id", checklist.id)
    .is("parent_item_id", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Two round trips whatever the length: every top-level item in one
  // insert (returned in insert order), then every sub-item in one more.
  const base = (lastItem?.position ?? 0) + 1024;
  if (lines.length === 0) return { checklistId: checklist.id, created, added: 0 };
  const { data: parents, error } = await db
    .from("task_checklist_items")
    .insert(
      lines.map((line, i) => ({
        checklist_id: checklist!.id,
        task_id: args.taskId,
        property_id: args.propertyId,
        text: line.text,
        done: line.done,
        position: base + i * 1024,
      })),
    )
    .select("id, position");
  if (error || !parents) return { error: error?.message ?? "Couldn't add the items" };
  // Match by position, not array index — the safe way to pair rows back up.
  const parentAt = new Map(parents.map((p) => [p.position, p.id] as const));
  const children = lines.flatMap((line, i) =>
    line.children.map((c, j) => ({
      checklist_id: checklist!.id,
      task_id: args.taskId,
      property_id: args.propertyId,
      parent_item_id: parentAt.get(base + i * 1024)!,
      text: c.text,
      done: c.done,
      position: (j + 1) * 1024,
    })),
  );
  if (children.length > 0) {
    const { error: childErr } = await db.from("task_checklist_items").insert(children);
    if (childErr) return { error: childErr.message };
  }
  const added = lines.length + children.length;
  return { checklistId: checklist.id, created, added };
}
