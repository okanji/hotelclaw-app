"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { addChecklistItemsFor } from "@/lib/tasks/checklist-write";

type ActionError = { error: string };
const Uuid = z.string().uuid();
const Text = z.string().trim().min(1).max(500);

/**
 * Per-task checklists (migration 0117). Writes go through the caller's RLS
 * session, so `activity_log` attributes "added a checklist" / "completed
 * <checklist>" to the person; counters on `tasks` are trigger-maintained.
 */

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function createChecklist(input: {
  taskId: string;
  name: string;
  /** Optional pasted list ("- [x] Keys", indented lines nest). */
  items?: string;
}): Promise<{ id: string } | ActionError> {
  const parsed = z
    .object({ taskId: Uuid, name: z.string().trim().min(1).max(120), items: z.string().max(20000).optional() })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };
  const { data: task } = await supabase
    .from("tasks")
    .select("property_id")
    .eq("id", parsed.data.taskId)
    .maybeSingle();
  if (!task) return { error: "Task not found" };
  // A NEW checklist each time (two "Task Prep" lists on one task is the
  // person's call); the shared writer find-or-creates, so name-collide on purpose.
  const { data: existing } = await supabase
    .from("task_checklists")
    .select("name")
    .eq("task_id", parsed.data.taskId);
  let name = parsed.data.name;
  const taken = new Set((existing ?? []).map((c) => c.name.toLowerCase()));
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${parsed.data.name} ${n}`;
  const res = await addChecklistItemsFor(supabase, {
    propertyId: task.property_id,
    taskId: parsed.data.taskId,
    name,
    items: parsed.data.items ?? "",
  });
  return "error" in res ? res : { id: res.checklistId };
}

export async function renameChecklist(input: { checklistId: string; name: string }): Promise<{ ok: true } | ActionError> {
  const parsed = z.object({ checklistId: Uuid, name: z.string().trim().min(1).max(120) }).safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("task_checklists")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.checklistId);
  return error ? { error: error.message } : { ok: true };
}

export async function deleteChecklist(checklistId: string): Promise<{ ok: true } | ActionError> {
  if (!Uuid.safeParse(checklistId).success) return { error: "Invalid input" };
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase.from("task_checklists").delete().eq("id", checklistId);
  return error ? { error: error.message } : { ok: true };
}

export async function addChecklistItem(input: {
  checklistId: string;
  text: string;
  parentItemId?: string | null;
  /** Insert right after this sibling (Enter on a row); default = the end. */
  afterItemId?: string | null;
}): Promise<{ id: string } | ActionError> {
  const parsed = z
    .object({ checklistId: Uuid, text: Text, parentItemId: Uuid.nullish(), afterItemId: Uuid.nullish() })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };
  const { data: checklist } = await supabase
    .from("task_checklists")
    .select("id, task_id, property_id")
    .eq("id", parsed.data.checklistId)
    .maybeSingle();
  if (!checklist) return { error: "Checklist not found" };

  let q = supabase
    .from("task_checklist_items")
    .select("id, position")
    .eq("checklist_id", checklist.id)
    .order("position", { ascending: true });
  q = parsed.data.parentItemId ? q.eq("parent_item_id", parsed.data.parentItemId) : q.is("parent_item_id", null);
  const { data: siblings } = await q;
  const list = siblings ?? [];
  let position = (list[list.length - 1]?.position ?? 0) + 1024;
  if (parsed.data.afterItemId) {
    const i = list.findIndex((s) => s.id === parsed.data.afterItemId);
    if (i >= 0) {
      const next = list[i + 1];
      position = next ? (list[i]!.position + next.position) / 2 : list[i]!.position + 1024;
    }
  }
  const { data, error } = await supabase
    .from("task_checklist_items")
    .insert({
      checklist_id: checklist.id,
      task_id: checklist.task_id,
      property_id: checklist.property_id,
      parent_item_id: parsed.data.parentItemId ?? null,
      text: parsed.data.text,
      position,
    })
    .select("id")
    .single();
  return error || !data ? { error: error?.message ?? "Couldn't add" } : { id: data.id };
}

export async function updateChecklistItem(input: {
  itemId: string;
  text?: string;
  done?: boolean;
  assigneeId?: string | null;
  position?: number;
  parentItemId?: string | null;
}): Promise<{ ok: true } | ActionError> {
  const parsed = z
    .object({
      itemId: Uuid,
      text: Text.optional(),
      done: z.boolean().optional(),
      assigneeId: Uuid.nullish(),
      position: z.number().finite().optional(),
      parentItemId: Uuid.nullish(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };
  const patch: {
    text?: string;
    done?: boolean;
    assignee_id?: string | null;
    position?: number;
    parent_item_id?: string | null;
  } = {};
  if (parsed.data.text !== undefined) patch.text = parsed.data.text;
  if (parsed.data.done !== undefined) patch.done = parsed.data.done;
  if (parsed.data.assigneeId !== undefined) {
    if (parsed.data.assigneeId) {
      // The person must belong to the item's property.
      const { data: item } = await supabase
        .from("task_checklist_items")
        .select("property_id")
        .eq("id", parsed.data.itemId)
        .maybeSingle();
      if (!item) return { error: "Item not found" };
      const { data: member } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("property_id", item.property_id)
        .eq("user_id", parsed.data.assigneeId)
        .maybeSingle();
      if (!member) return { error: "That person isn't a member here" };
    }
    patch.assignee_id = parsed.data.assigneeId ?? null;
  }
  if (parsed.data.position !== undefined) patch.position = parsed.data.position;
  if (parsed.data.parentItemId !== undefined) patch.parent_item_id = parsed.data.parentItemId;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { data, error } = await supabase
    .from("task_checklist_items")
    .update(patch)
    .eq("id", parsed.data.itemId)
    .select("id");
  if (error) return { error: error.message };
  return data && data.length > 0 ? { ok: true } : { error: "Item not found" };
}

export async function deleteChecklistItem(itemId: string): Promise<{ ok: true } | ActionError> {
  if (!Uuid.safeParse(itemId).success) return { error: "Invalid input" };
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase.from("task_checklist_items").delete().eq("id", itemId);
  return error ? { error: error.message } : { ok: true };
}
