"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(200);
/** `YYYY-MM-DD` — a milestone is a day, not an instant. */
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Project milestones (migration 0106): named dates inside a project's window
 * — "Wireframes signed off", "Dev handoff", "Public launch". Writes go through
 * the caller's own RLS session so `activity_log` attributes them to the person.
 */
export async function createMilestone(input: {
  projectId: string;
  name: string;
  dueDate: string;
}): Promise<{ id: string } | ActionError> {
  const parsed = z
    .object({ projectId: Uuid, name: Name, dueDate: DateOnly })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: project } = await supabase
    .from("projects")
    .select("property_id")
    .eq("id", parsed.data.projectId)
    .maybeSingle();
  if (!project) return { error: "Project not found" };

  const { data: last } = await supabase
    .from("project_milestones")
    .select("position")
    .eq("project_id", parsed.data.projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("project_milestones")
    .insert({
      property_id: project.property_id,
      project_id: parsed.data.projectId,
      name: parsed.data.name,
      due_date: parsed.data.dueDate,
      position: (last?.position ?? 0) + 1024,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not add milestone" };
  return { id: data.id };
}

const MilestonePatch = z.object({
  name: Name.optional(),
  dueDate: DateOnly.optional(),
  /** true → stamp completed_at now; false → clear it. */
  completed: z.boolean().optional(),
});

export async function updateMilestone(
  milestoneId: string,
  patch: z.input<typeof MilestonePatch>,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(milestoneId);
  if (!id.success) return { error: "Invalid milestone" };
  const parsed = MilestonePatch.safeParse(patch);
  if (!parsed.success) return { error: "Invalid input" };

  const update: {
    name?: string;
    due_date?: string;
    completed_at?: string | null;
  } = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.dueDate !== undefined) update.due_date = parsed.data.dueDate;
  if (parsed.data.completed !== undefined)
    update.completed_at = parsed.data.completed ? new Date().toISOString() : null;
  if (Object.keys(update).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_milestones")
    .update(update)
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteMilestone(
  milestoneId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(milestoneId);
  if (!id.success) return { error: "Invalid milestone" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_milestones")
    .delete()
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}
