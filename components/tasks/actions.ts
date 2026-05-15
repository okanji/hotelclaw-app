"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  createNotification,
  type NotificationType,
} from "@/lib/notifications/server";
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

const MoveSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(Statuses),
  position: z.number().finite(),
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

  // New cards land at the top of their column.
  const position = await topPositionFor(
    supabase,
    parsed.data.propertyId,
    parsed.data.status,
  );

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
      position,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Insert failed" };

  // Notify the assignee if it's not the creator themselves.
  if (parsed.data.assigneeId && parsed.data.assigneeId !== user.id) {
    await emitTaskAssignmentNotifications({
      taskId: data.id,
      propertyId: parsed.data.propertyId,
      title: parsed.data.title,
      byUserId: user.id,
      previousAssigneeId: null,
      nextAssigneeId: parsed.data.assigneeId,
    });
  }

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

  // Read the previous assignee/status so we can detect changes and emit
  // assigned/unassigned notifications (and re-anchor the card on a status move).
  const { data: before } = await supabase
    .from("tasks")
    .select("assignee_id, title, property_id, status")
    .eq("id", parsed.data.taskId)
    .maybeSingle();

  const patch: TaskUpdate = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    patch.description = parsed.data.description;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.assigneeId !== undefined)
    patch.assignee_id = parsed.data.assigneeId;

  // Changing status moves the card to a different column — drop it at the
  // top so it doesn't inherit a stale position from its old column.
  if (
    parsed.data.status !== undefined &&
    before &&
    parsed.data.status !== before.status
  ) {
    patch.position = await topPositionFor(
      supabase,
      before.property_id,
      parsed.data.status,
    );
  }

  const { data: row, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", parsed.data.taskId)
    .select("property_id, title")
    .single();

  if (error || !row) return { error: error?.message ?? "Update failed" };

  if (
    parsed.data.assigneeId !== undefined &&
    before &&
    parsed.data.assigneeId !== before.assignee_id
  ) {
    await emitTaskAssignmentNotifications({
      taskId: parsed.data.taskId,
      propertyId: row.property_id,
      title: row.title,
      byUserId: user.id,
      previousAssigneeId: before.assignee_id,
      nextAssigneeId: parsed.data.assigneeId,
    });
  }

  revalidatePath(`/p/${row.property_id}/tasks`);
  revalidatePath(`/p/${row.property_id}/tasks/${parsed.data.taskId}`);
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

  revalidatePath(`/p/${row.property_id}/tasks`);
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

/* -------------------------------------------------------------------------- */

/**
 * Returns a `position` that places a card just above the current top card of
 * a column (or a sensible default when the column is empty). Used for newly
 * created cards and for cards moved between columns outside of a drag.
 */
async function topPositionFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  status: (typeof Statuses)[number],
): Promise<number> {
  const { data: top } = await supabase
    .from("tasks")
    .select("position")
    .eq("property_id", propertyId)
    .eq("status", status)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return top ? top.position - 1024 : 1024;
}

async function emitTaskAssignmentNotifications(args: {
  taskId: string;
  propertyId: string;
  title: string;
  byUserId: string;
  previousAssigneeId: string | null;
  nextAssigneeId: string | null;
}): Promise<void> {
  const service = createServiceClient();
  const { data: actor } = await service
    .from("profiles")
    .select("full_name")
    .eq("id", args.byUserId)
    .maybeSingle();
  const byUserName = actor?.full_name ?? null;

  const events: Array<{ userId: string; type: NotificationType }> = [];
  if (args.nextAssigneeId && args.nextAssigneeId !== args.byUserId) {
    events.push({ userId: args.nextAssigneeId, type: "task_assigned" });
  }
  if (
    args.previousAssigneeId &&
    args.previousAssigneeId !== args.byUserId &&
    args.previousAssigneeId !== args.nextAssigneeId
  ) {
    events.push({ userId: args.previousAssigneeId, type: "task_unassigned" });
  }

  await Promise.all(
    events.map((e) =>
      createNotification({
        userId: e.userId,
        propertyId: args.propertyId,
        type: e.type,
        payload: {
          taskId: args.taskId,
          taskTitle: args.title,
          byUserId: args.byUserId,
          byUserName,
        },
      }),
    ),
  );
}
