import "server-only";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import {
  emitTaskAssignmentNotifications,
  topPositionFor,
} from "@/lib/tasks/mutations";
import {
  describeIntake,
  suggestionOutcomes,
  type TriageIntake,
  type TriageSuggestionField,
} from "@/lib/tasks/triage-logic";

type Db = SupabaseClient<Database>;
type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

/**
 * The triage queue (migration 0111) — Linear's per-team Triage inbox.
 *
 * Tasks with `triage_state = 'pending'` are held off every board
 * (`getTasks` filters them) until a person Accepts or Declines them here.
 * Intake today: guest chatbot tickets (`create_ticket` in the guest-bot
 * registry — untrusted guests, so staff vet them) and "Submit to triage"
 * (`createTaskFor({ triage: true })`).
 *
 * Every read and write runs on the CALLER's client (cookie or Bearer), so
 * RLS is the tenancy gate and the 0111 trigger's `auth.uid()` attributes the
 * triage_* activity rows to the person who decided. The service client is
 * used only for side tables the caller can't write (`task_suggestions`) or
 * read (`workflow_events`), and only for task ids the caller already saw.
 */

// Same columns as the board's `getTasks`, so a queued row can feed
// `<TaskDetail>` without a second shape — plus the triage fields and the
// 0108 `number` (rows get the same `key` as `getTasks`).
const QUEUE_COLUMNS =
  "id, number, title, description, status, priority, assignee_id, created_by, due_at, scheduled_start, scheduled_end, position, parent_id, labels, project_name, space_id, project_id, recurrence, recurrence_of, source, source_workflow_id, source_workflow_run_id, created_at, updated_at, triage_state, triage_note";

const Priorities = ["none", "low", "medium", "high", "urgent"] as const;

type QueueRow = Pick<
  Database["public"]["Tables"]["tasks"]["Row"],
  | "id"
  | "number"
  | "title"
  | "description"
  | "status"
  | "priority"
  | "assignee_id"
  | "created_by"
  | "due_at"
  | "scheduled_start"
  | "scheduled_end"
  | "position"
  | "parent_id"
  | "labels"
  | "project_name"
  | "space_id"
  | "project_id"
  | "recurrence"
  | "recurrence_of"
  | "source"
  | "source_workflow_id"
  | "source_workflow_run_id"
  | "created_at"
  | "updated_at"
  | "triage_state"
  | "triage_note"
>;

export type TriageQueueItem = QueueRow & { intake: TriageIntake; key: string | null };

/** Pending tasks, newest first — optionally one team's queue. */
export async function getTriageQueue(
  supabase: Db,
  propertyId: string,
  opts: { spaceId?: string | null } = {},
): Promise<TriageQueueItem[]> {
  let query = supabase
    .from("tasks")
    .select(QUEUE_COLUMNS)
    .eq("property_id", propertyId)
    .eq("triage_state", "pending")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.spaceId) query = query.eq("space_id", opts.spaceId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as QueueRow[];
  if (rows.length === 0) return [];

  // Provenance: guest tickets carry a `chatbot.order_created` event; people
  // need a name. Both lookups are best-effort — a missing label degrades to
  // "AI" / "Teammate", never an error.
  const service = createServiceClient();
  const ids = rows.map((r) => r.id);
  const creatorIds = [
    ...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v)),
  ];
  const [eventsRes, profilesRes, propertyRes] = await Promise.all([
    service
      .from("workflow_events")
      .select("entity_id, payload")
      .eq("property_id", propertyId)
      .eq("event_type", "chatbot.order_created")
      .in("entity_id", ids),
    creatorIds.length > 0
      ? service.from("profiles").select("id, full_name").in("id", creatorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    supabase.from("properties").select("task_prefix").eq("id", propertyId).maybeSingle(),
  ]);
  const prefix = propertyRes.data?.task_prefix ?? null;
  const guestByTask = new Map<string, { chatbotName: string | null; guestName: string | null }>();
  for (const e of eventsRes.data ?? []) {
    if (!e.entity_id) continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    guestByTask.set(e.entity_id, {
      chatbotName: typeof p.chatbot_name === "string" ? p.chatbot_name : null,
      guestName: typeof p.guest_name === "string" ? p.guest_name : null,
    });
  }
  const nameById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p.full_name ?? null] as const),
  );

  return rows.map((r) => ({
    ...r,
    key: formatTaskKey(prefix, r.number),
    intake: describeIntake({
      source: r.source,
      creatorName: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
      guestTicket: guestByTask.get(r.id) ?? null,
    }),
  }));
}

/** The sidebar badge number — a head-only count on the partial index. */
export async function getTriagePendingCount(
  supabase: Db,
  propertyId: string,
  opts: { spaceId?: string | null } = {},
): Promise<number> {
  let query = supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .eq("triage_state", "pending");
  if (opts.spaceId) query = query.eq("space_id", opts.spaceId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export const AcceptTriageSchema = z.object({
  taskId: z.string().uuid(),
  /** When given (the REST route), the write is also pinned to it. */
  propertyId: z.string().uuid().optional(),
  // Overrides applied in the SAME update as the accept. Absent = keep.
  spaceId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(Priorities).optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export const DeclineTriageSchema = z.object({
  taskId: z.string().uuid(),
  propertyId: z.string().uuid().optional(),
  note: z.string().trim().max(1000).optional(),
});

type TriageResult =
  | { ok: true; propertyId: string; taskId: string }
  | { error: string };

/**
 * Accept a pending task onto the board. One guarded update (`triage_state =
 * 'pending'` in the WHERE) so two people accepting at once can't both win;
 * the card lands at the top of its column like a fresh task.
 *
 * Notifications: nobody was told about a pending task, so the assignee —
 * whether chosen here or set at intake — gets the normal `task_assigned`
 * through the shared `emitTaskAssignmentNotifications` (which skips the
 * accepter assigning themselves).
 */
export async function acceptTriageTaskFor(
  supabase: Db,
  userId: string,
  input: z.input<typeof AcceptTriageSchema>,
): Promise<TriageResult> {
  const parsed = AcceptTriageSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { taskId } = parsed.data;

  let read = supabase
    .from("tasks")
    .select("property_id, status, triage_state")
    .eq("id", taskId);
  if (parsed.data.propertyId) read = read.eq("property_id", parsed.data.propertyId);
  const { data: before } = await read.maybeSingle();
  if (!before) return { error: "Task not found" };
  if (before.triage_state !== "pending") return { error: "Already triaged" };

  const patch: TaskUpdate = {
    triage_state: "accepted",
    triaged_by: userId,
    triaged_at: new Date().toISOString(),
    position: await topPositionFor(supabase, before.property_id, before.status),
  };
  if (parsed.data.spaceId !== undefined) patch.space_id = parsed.data.spaceId;
  if (parsed.data.assigneeId !== undefined) patch.assignee_id = parsed.data.assigneeId;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.projectId !== undefined) patch.project_id = parsed.data.projectId;

  const { data: row, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("property_id", before.property_id)
    .eq("triage_state", "pending")
    .select("property_id, title, assignee_id, space_id, priority")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "Already triaged" };

  if (row.assignee_id) {
    await emitTaskAssignmentNotifications({
      taskId,
      propertyId: row.property_id,
      title: row.title,
      byUserId: userId,
      previousAssigneeId: null,
      nextAssigneeId: row.assignee_id,
    });
  }

  await resolvePendingSuggestions(row.property_id, taskId, userId, {
    space_id: row.space_id,
    assignee_id: row.assignee_id,
    priority: row.priority,
  });

  return { ok: true, propertyId: row.property_id, taskId };
}

/** Decline: the task stays (history, the guest's words) but never boards. */
export async function declineTriageTaskFor(
  supabase: Db,
  userId: string,
  input: z.input<typeof DeclineTriageSchema>,
): Promise<TriageResult> {
  const parsed = DeclineTriageSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { taskId } = parsed.data;

  let write = supabase
    .from("tasks")
    .update({
      triage_state: "declined",
      triaged_by: userId,
      triaged_at: new Date().toISOString(),
      triage_note: parsed.data.note || null,
    })
    .eq("id", taskId)
    .eq("triage_state", "pending");
  if (parsed.data.propertyId) write = write.eq("property_id", parsed.data.propertyId);
  const { data: row, error } = await write.select("property_id").maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "Already triaged" };

  await resolvePendingSuggestions(row.property_id, taskId, userId, null);
  return { ok: true, propertyId: row.property_id, taskId };
}

/**
 * Close the task's pending AI suggestions so the chips don't linger on the
 * accepted task and the trust ladder records the outcome. Service client:
 * `task_suggestions` has no member write policy (the suggestions route
 * writes it the same way). Fail-soft — the triage decision already landed.
 */
async function resolvePendingSuggestions(
  propertyId: string,
  taskId: string,
  userId: string,
  final: { space_id: string | null; assignee_id: string | null; priority: string } | null,
) {
  try {
    const service = createServiceClient();
    const { data } = await service
      .from("task_suggestions")
      .select("id, field, suggested_value")
      .eq("property_id", propertyId)
      .eq("task_id", taskId)
      .eq("status", "pending");
    const outcomes = suggestionOutcomes(
      (data ?? []) as { id: string; field: TriageSuggestionField; suggested_value: string }[],
      final,
    );
    const resolvedAt = new Date().toISOString();
    await Promise.all(
      outcomes.map((o) =>
        service
          .from("task_suggestions")
          .update({ status: o.status, resolved_at: resolvedAt, resolved_by: userId })
          .eq("id", o.id),
      ),
    );
  } catch (err) {
    console.warn("[triage] resolving suggestions failed", taskId, err);
  }
}
