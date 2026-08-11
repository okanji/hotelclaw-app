"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications/server";
// Task writes live in lib/tasks/mutations so the REST routes (mobile, Bearer
// auth) and these actions (web, cookie auth) can't diverge.
import { createTaskFor, updateTaskFor } from "@/lib/tasks/mutations";

const Statuses = ["todo", "in_progress", "blocked", "done"] as const;
const Priorities = ["none", "low", "medium", "high", "urgent"] as const;

const CreateSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(Statuses).default("todo"),
  priority: z.enum(Priorities).default("none"),
  assigneeId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  spaceId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

const UpdateSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(Statuses).optional(),
  priority: z.enum(Priorities).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  labels: z.array(z.string().min(1).max(40)).optional(),
  projectName: z.string().max(120).nullable().optional(),
});

const MoveSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(Statuses),
  position: z.number().finite(),
});

export async function createTask(
  input: z.input<typeof CreateSchema>,
): Promise<{ taskId: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const result = await createTaskFor(supabase, user.id, input);
  if ("error" in result) return result;

  revalidatePath(`/p/${result.propertyId}/tasks`);
  return { taskId: result.taskId };
}

export async function updateTask(
  input: z.input<typeof UpdateSchema>,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const result = await updateTaskFor(supabase, user.id, input);
  if ("error" in result) return result;

  revalidatePath(`/p/${result.propertyId}/tasks`);
  revalidatePath(`/p/${result.propertyId}/tasks/${result.taskId}`);
  return { ok: true };
}

/**
 * Persist a Kanban drag: the card's new column (`status`) and its new
 * fractional `position` within that column. Kept separate from `updateTask`
 * so the board's optimistic drag path stays lean and never touches
 * notifications.
 */
export async function moveTask(
  input: z.input<typeof MoveSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: row, error } = await supabase
    .from("tasks")
    .update({ status: parsed.data.status, position: parsed.data.position })
    .eq("id", parsed.data.taskId)
    .select("property_id")
    .single();

  if (error || !row) return { error: error?.message ?? "Move failed" };

  // Deliberately NO revalidatePath here. The board is fully client-rendered
  // (the tasks route's page.tsx renders null; data comes from React Query via
  // /api/.../tasks), and the kanban move path already updates the cache
  // optimistically + `invalidateQueries(["tasks"])` on settle, plus a
  // Liveblocks broadcast for teammates. revalidatePath would re-render the
  // ENTIRE property layout server tree (all 14 mounted surfaces + its data
  // fetches) on every drag — the dev "Rendering…" flash — for zero benefit,
  // since nothing server-rendered consumes this write.
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

/**
 * Escalate a task up the reporting chain. Resolves the target from the org
 * chart: the assignee's manager (`memberships.manager_id`), or — if the task
 * is unassigned — the owning team's lead (`spaces.lead_user_id`). Notifies
 * that person. This is the "who do I bump this to?" answer turned into one
 * click, powered by the hierarchy rather than a guess.
 */
export async function escalateTask(
  taskId: string,
): Promise<{ ok: true; targetName: string } | { error: string }> {
  const id = z.string().uuid().safeParse(taskId);
  if (!id.success) return { error: "Invalid task" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const service = createServiceClient();
  const { data: task } = await service
    .from("tasks")
    .select("assignee_id, space_id, title, property_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!task) return { error: "Task not found" };

  const { loadOrgChart } = await import("@/lib/org/queries");
  const org = await loadOrgChart(service, task.property_id);

  // Assignee's manager first; fall back to the owning team's lead.
  let targetId: string | null = null;
  let reason: "manager" | "team_lead" = "manager";
  if (task.assignee_id) {
    targetId =
      org.people.find((p) => p.id === task.assignee_id)?.managerId ?? null;
    reason = "manager";
  }
  if (!targetId && task.space_id) {
    targetId =
      org.teams.find((t) => t.id === task.space_id)?.leadUserId ?? null;
    reason = "team_lead";
  }

  if (!targetId) {
    return {
      error:
        "No one to escalate to — set a manager (for the assignee) or a team lead in the org chart.",
    };
  }
  if (targetId === user.id) {
    return { error: "That escalates to you — you're already on it." };
  }

  const targetName =
    org.people.find((p) => p.id === targetId)?.name ?? "your manager";
  const { data: actor } = await service
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  await createNotification({
    userId: targetId,
    propertyId: task.property_id,
    type: "task_escalated",
    payload: {
      taskId: id.data,
      taskTitle: task.title,
      byUserId: user.id,
      byUserName: actor?.full_name ?? null,
      reason,
    },
  });

  revalidatePath(`/p/${task.property_id}/tasks/${id.data}`);
  return { ok: true, targetName };
}

/* -------------------------------------------------------------------------- */
