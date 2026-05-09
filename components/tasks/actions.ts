"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

const Statuses = ["todo", "in_progress", "blocked", "done"] as const;
const Priorities = ["low", "medium", "high", "urgent"] as const;

const CreateSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(Statuses).default("todo"),
  priority: z.enum(Priorities).default("medium"),
  assigneeId: z.string().uuid().nullable().optional(),
});

const UpdateSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(Statuses).optional(),
  priority: z.enum(Priorities).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});

export async function createTask(
  input: z.input<typeof CreateSchema>,
): Promise<{ taskId: string } | { error: string }> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      property_id: parsed.data.propertyId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      priority: parsed.data.priority,
      assignee_id: parsed.data.assigneeId ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Insert failed" };
  revalidatePath(`/p/${parsed.data.propertyId}/tasks`);
  return { taskId: data.id };
}

export async function updateTask(
  input: z.input<typeof UpdateSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const patch: TaskUpdate = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    patch.description = parsed.data.description;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.assigneeId !== undefined)
    patch.assignee_id = parsed.data.assigneeId;

  const { data: row, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", parsed.data.taskId)
    .select("property_id")
    .single();

  if (error || !row) return { error: error?.message ?? "Update failed" };
  revalidatePath(`/p/${row.property_id}/tasks`);
  revalidatePath(`/p/${row.property_id}/tasks/${parsed.data.taskId}`);
  return { ok: true };
}

export async function deleteTask(
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: row, error: fetchErr } = await supabase
    .from("tasks")
    .select("property_id")
    .eq("id", taskId)
    .single();
  if (fetchErr || !row) return { error: fetchErr?.message ?? "Not found" };

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${row.property_id}/tasks`);
  return { ok: true };
}
