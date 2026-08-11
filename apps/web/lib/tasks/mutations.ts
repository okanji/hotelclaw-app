import "server-only";
import { z } from "zod";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createNotification,
  type NotificationType,
} from "@/lib/notifications/server";
import type { Database } from "@/lib/db/types";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];
type Db = SupabaseClient<Database>;

const Statuses = ["todo", "in_progress", "blocked", "done"] as const;
const Priorities = ["none", "low", "medium", "high", "urgent"] as const;

export const CreateTaskSchema = z.object({
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

export const UpdateTaskSchema = z.object({
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

export type CreateTaskInput = z.input<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskSchema>;

/**
 * Task writes, decoupled from how the caller authenticated.
 *
 * The server actions in `components/tasks/actions.ts` pass a cookie-backed
 * client; the REST routes under `/api/properties/[propertyId]/tasks` pass a
 * Bearer-backed one for mobile. Both go through here so mobile can't quietly
 * diverge from web — assignment notifications, background triage, and the
 * top-of-column positioning all happen either way.
 */

export async function topPositionFor(
  supabase: Db,
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

export async function emitTaskAssignmentNotifications(args: {
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

export async function createTaskFor(
  supabase: Db,
  userId: string,
  input: CreateTaskInput,
): Promise<{ taskId: string; propertyId: string } | { error: string }> {
  const parsed = CreateTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  // Team defaults to the creator's home team (org chart: memberships
  // .primary_space_id). `spaceId` absent (undefined) → default; explicit
  // null → deliberately no team (the dialog's "No team" choice); a uuid →
  // that team. This is why the field is `.nullable().optional()`.
  let spaceId = parsed.data.spaceId;
  if (spaceId === undefined) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("primary_space_id")
      .eq("property_id", parsed.data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    spaceId = membership?.primary_space_id ?? null;
  }

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
      created_by: userId,
      position,
      parent_id: parsed.data.parentId ?? null,
      space_id: spaceId,
      project_id: parsed.data.projectId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Insert failed" };

  // Notify the assignee if it's not the creator themselves.
  if (parsed.data.assigneeId && parsed.data.assigneeId !== userId) {
    await emitTaskAssignmentNotifications({
      taskId: data.id,
      propertyId: parsed.data.propertyId,
      title: parsed.data.title,
      byUserId: userId,
      previousAssigneeId: null,
      nextAssigneeId: parsed.data.assigneeId,
    });
  }

  // Bare tasks (missing team/assignee/priority) get triaged in the
  // background — suggestions land as pending rows on the task detail; the
  // bot no-ops when nothing is missing.
  if (
    !parsed.data.spaceId ||
    !parsed.data.assigneeId ||
    parsed.data.priority === "none"
  ) {
    const taskId = data.id;
    const propertyId = parsed.data.propertyId;
    after(async () => {
      try {
        const { triageTask } = await import("@/lib/ai/bots/triage-bot");
        await triageTask({ propertyId, taskId });
      } catch (err) {
        console.error("[triage] background triage failed", taskId, err);
      }
    });
  }

  return { taskId: data.id, propertyId: parsed.data.propertyId };
}

export async function updateTaskFor(
  supabase: Db,
  userId: string,
  input: UpdateTaskInput,
): Promise<{ ok: true; propertyId: string; taskId: string } | { error: string }> {
  const parsed = UpdateTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

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
  if (parsed.data.dueAt !== undefined) patch.due_at = parsed.data.dueAt;
  if (parsed.data.labels !== undefined) patch.labels = parsed.data.labels;
  if (parsed.data.projectName !== undefined)
    patch.project_name = parsed.data.projectName;

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
      byUserId: userId,
      previousAssigneeId: before.assignee_id,
      nextAssigneeId: parsed.data.assigneeId,
    });
  }

  return { ok: true, propertyId: row.property_id, taskId: parsed.data.taskId };
}
