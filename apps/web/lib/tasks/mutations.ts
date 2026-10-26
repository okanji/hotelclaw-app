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
import { isUuid } from "@/lib/tasks/statuses";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];
type Db = SupabaseClient<Database>;

const Priorities = ["none", "low", "medium", "high", "urgent"] as const;

/**
 * `status` accepts EITHER a status row id (uuid — the pipeline truth, 0114)
 * OR a legacy literal (`todo|in_progress|blocked|done`, what mobile and the
 * category columns still send). The DB resolver turns a literal into a
 * status of the task's list, so both spellings are complete writes.
 */
const StatusInput = z.string().min(1).max(60);

export const CreateTaskSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: StatusInput.default("todo"),
  priority: z.enum(Priorities).default("none"),
  assigneeId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  spaceId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  /** The list (0114). Absent → parent's list, else the team's default, else General. */
  listId: z.string().uuid().nullable().optional(),
  /** File into the triage queue (0111) instead of straight onto the board. */
  triage: z.boolean().optional(),
});

export const UpdateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: StatusInput.optional(),
  /** Move to another list (0114); the status is remapped by category. */
  listId: z.string().uuid().optional(),
  priority: z.enum(Priorities).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  labels: z.array(z.string().min(1).max(40)).optional(),
  projectName: z.string().max(120).nullable().optional(),
  /** Repeat cadence (migration 0107); null clears it. */
  recurrence: z.enum(["daily", "weekly", "biweekly", "monthly"]).nullable().optional(),
  /** Planning (0111): points, cycle, project milestone. null clears each. */
  estimate: z.number().int().min(0).max(100).nullable().optional(),
  cycleId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
});

/** Push a due date forward by one cadence, keeping the time of day. */
export function nextOccurrence(
  dueAt: string | null,
  recurrence: "daily" | "weekly" | "biweekly" | "monthly",
  from: Date = new Date(),
): string {
  // No due date: the next one is due a cadence from NOW, at 17:00.
  const base = dueAt ? new Date(dueAt) : new Date(from.setHours(17, 0, 0, 0));
  const next = new Date(base);
  switch (recurrence) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "biweekly":
      next.setDate(next.getDate() + 14);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next.toISOString();
}

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

/** Split a `status` input into the column the DB row carries it in. */
function statusPatch(status: string): { status: TaskUpdate["status"] } | { status_id: string } {
  return isUuid(status)
    ? { status_id: status }
    : { status: status as NonNullable<TaskUpdate["status"]> };
}

/**
 * Top of the column a card is about to land in. A status id → that exact
 * pipeline column; a legacy literal → the property-wide category column
 * (what the multi-list board shows), which is what it was before 0114.
 */
export async function topPositionFor(
  supabase: Db,
  propertyId: string,
  status: string,
): Promise<number> {
  let q = supabase
    .from("tasks")
    .select("position")
    .eq("property_id", propertyId);
  q = isUuid(status)
    ? q.eq("status_id", status)
    : q.eq("status", status as NonNullable<TaskUpdate["status"]>);
  const { data: top } = await q
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
      ...statusPatch(parsed.data.status),
      priority: parsed.data.priority,
      assignee_id: parsed.data.assigneeId ?? null,
      created_by: userId,
      position,
      parent_id: parsed.data.parentId ?? null,
      space_id: spaceId,
      project_id: parsed.data.projectId ?? null,
      // null/absent → the 0114 resolver picks parent → team default → General.
      ...(parsed.data.listId ? { list_id: parsed.data.listId } : {}),
      // Only stamped when asked — a normal create leaves it NULL.
      ...(parsed.data.triage ? { triage_state: "pending" as const } : {}),
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Insert failed" };

  // Notify the assignee if it's not the creator themselves. A triage
  // submission waits: `acceptTriageTaskFor` notifies once it's accepted.
  if (
    parsed.data.assigneeId &&
    parsed.data.assigneeId !== userId &&
    !parsed.data.triage
  ) {
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
    .select(
      "assignee_id, title, property_id, status, status_id, list_id, completed_at, description, priority, due_at, labels, space_id, project_id, project_name, parent_id, recurrence",
    )
    .eq("id", parsed.data.taskId)
    .maybeSingle();

  const patch: TaskUpdate = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    patch.description = parsed.data.description;
  if (parsed.data.status !== undefined) Object.assign(patch, statusPatch(parsed.data.status));
  if (parsed.data.listId !== undefined) {
    // Fence to the task's property — RLS alone would accept a list from
    // another property the caller also belongs to.
    if (before) {
      const { data: list } = await supabase
        .from("lists")
        .select("id")
        .eq("id", parsed.data.listId)
        .eq("property_id", before.property_id)
        .maybeSingle();
      if (!list) return { error: "List not found" };
    }
    patch.list_id = parsed.data.listId;
  }
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.assigneeId !== undefined)
    patch.assignee_id = parsed.data.assigneeId;
  if (parsed.data.dueAt !== undefined) patch.due_at = parsed.data.dueAt;
  if (parsed.data.labels !== undefined) patch.labels = parsed.data.labels;
  if (parsed.data.projectName !== undefined)
    patch.project_name = parsed.data.projectName;
  if (parsed.data.recurrence !== undefined)
    patch.recurrence = parsed.data.recurrence;
  if (parsed.data.estimate !== undefined) patch.estimate = parsed.data.estimate;

  // Cycle + milestone ids arrive from the client, and RLS alone would accept
  // a row from ANOTHER property the caller also belongs to — fence both to
  // the task's own property (and a milestone to the task's project).
  if (parsed.data.cycleId !== undefined) {
    if (parsed.data.cycleId && before) {
      const { data: cycle } = await supabase
        .from("cycles")
        .select("id")
        .eq("id", parsed.data.cycleId)
        .eq("property_id", before.property_id)
        .maybeSingle();
      if (!cycle) return { error: "Cycle not found" };
    }
    patch.cycle_id = parsed.data.cycleId;
  }
  if (parsed.data.milestoneId !== undefined) {
    if (parsed.data.milestoneId && before) {
      const { data: milestone } = await supabase
        .from("project_milestones")
        .select("project_id")
        .eq("id", parsed.data.milestoneId)
        .eq("property_id", before.property_id)
        .maybeSingle();
      if (!milestone || milestone.project_id !== before.project_id) {
        return { error: "Milestone not found on this task's project" };
      }
    }
    patch.milestone_id = parsed.data.milestoneId;
  }

  // Changing status moves the card to a different column — drop it at the
  // top so it doesn't inherit a stale position from its old column.
  if (
    parsed.data.status !== undefined &&
    before &&
    parsed.data.status !== before.status &&
    parsed.data.status !== before.status_id
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
    .select("property_id, title, completed_at")
    .single();

  if (error || !row) return { error: error?.message ?? "Update failed" };

  // Recurring task completed → roll the next occurrence forward (gr8r's
  // model, migration 0107). The finished one stays done with its history;
  // the new one inherits owner / team / list / project / labels / cadence,
  // gets the due date pushed by one cadence, and starts with no sub-issues
  // in its list's open status. "Completed" = the DB stamped completed_at on
  // this write (0114) — so a pipeline's `closed` AND `done` statuses count.
  const cadence = (parsed.data.recurrence ?? before?.recurrence) ?? null;
  if (cadence && before && !before.completed_at && row.completed_at) {
    const position = await topPositionFor(supabase, before.property_id, "todo");
    const { error: rollError } = await supabase.from("tasks").insert({
      property_id: before.property_id,
      title: before.title,
      description: before.description ?? null,
      priority: before.priority,
      assignee_id: before.assignee_id,
      created_by: userId,
      position,
      parent_id: before.parent_id ?? null,
      space_id: before.space_id ?? null,
      list_id: before.list_id,
      project_id: before.project_id ?? null,
      project_name: before.project_name ?? null,
      labels: before.labels ?? [],
      due_at: nextOccurrence(before.due_at, cadence),
      recurrence: cadence,
      recurrence_of: parsed.data.taskId,
    });
    if (rollError) {
      console.error("[tasks] recurrence roll-forward failed", parsed.data.taskId, rollError);
    }
  }

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
