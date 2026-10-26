"use server";

import { z } from "zod";
import { requireManagement } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { LABEL_COLORS } from "@/components/labels/label-tokens";
import { STATUS_CATEGORIES, type StatusRow } from "@/lib/tasks/statuses";
import {
  deleteBlocker,
  fallbackFor,
  forkPlan,
  ladder,
  positionAfter,
  remapPlan,
  validateSet,
  problemMessage,
} from "@/lib/tasks/status-set-rules";
import type { EntityColor, StatusCategory } from "@/lib/db/types";

/**
 * Status-set editing (migration 0114) — owner / manager only (plan decision
 * G4: a pipeline is shared by every list that inherits it, so changing one
 * is a team-wide act). Every write re-validates the whole set with the pure
 * rules first so a person gets the friendly message, not a unique-index
 * error; the DB guards stay as the backstop.
 *
 * Gate = `requireManagement` on the set's property (RLS on `statuses` /
 * `status_sets` update + delete is management too; the gate exists so the
 * error is explicit and the guest drift test can see it).
 */

type ActionError = { error: string };
const Uuid = z.string().uuid();
const Color = z.enum(LABEL_COLORS as [EntityColor, ...EntityColor[]]);
const Category = z.enum(STATUS_CATEGORIES as [StatusCategory, ...StatusCategory[]]);

async function setRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  setId: string,
): Promise<StatusRow[]> {
  const { data } = await supabase
    .from("statuses")
    .select("id, status_set_id, property_id, name, category, is_blocked, color, position, archived_at")
    .eq("status_set_id", setId)
    .is("archived_at", null)
    .order("position");
  return (data ?? []) as StatusRow[];
}

type SetGate =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      set: { id: string; property_id: string; name: string; is_default: boolean };
      userId: string;
    };

async function gateForSet(setId: string): Promise<SetGate> {
  const supabase = await createClient();
  const { data: set } = await supabase
    .from("status_sets")
    .select("id, property_id, name, is_default")
    .eq("id", setId)
    .maybeSingle();
  if (!set) return { error: "Status set not found" };
  const gate = await requireManagement(set.property_id);
  if (!gate.ok) return { error: gate.error };
  return { supabase, set, userId: gate.userId };
}

const CreateStatusSchema = z.object({
  setId: Uuid,
  name: z.string().trim().min(1).max(60),
  category: Category,
  isBlocked: z.boolean().default(false),
  color: Color.optional(),
  /** Insert after this status (null = first). Omit = last. */
  afterId: Uuid.nullable().optional(),
});

export async function createStatus(
  input: z.input<typeof CreateStatusSchema>,
): Promise<{ id: string } | ActionError> {
  const parsed = CreateStatusSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await gateForSet(parsed.data.setId);
  if ("error" in ctx) return ctx;
  const { supabase, set } = ctx;
  const { name, category, isBlocked, color } = parsed.data;

  const rows = await setRows(supabase, set.id);
  const draft = {
    id: "new",
    name,
    category,
    is_blocked: isBlocked && category === "active",
    color: color ?? ("slate" as EntityColor),
    position: 0,
  };
  const problems = validateSet([...rows, draft]);
  if (problems.length) return { error: problemMessage(problems[0]) };

  const position =
    parsed.data.afterId === undefined
      ? (rows.at(-1)?.position ?? 0) + 1024
      : positionAfter(rows, parsed.data.afterId);

  const { data, error } = await supabase
    .from("statuses")
    .insert({
      status_set_id: set.id,
      property_id: set.property_id,
      name,
      category,
      is_blocked: draft.is_blocked,
      color: draft.color,
      position,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not add status" };
  return { id: data.id };
}

const UpdateStatusSchema = z.object({
  statusId: Uuid,
  name: z.string().trim().min(1).max(60).optional(),
  category: Category.optional(),
  isBlocked: z.boolean().optional(),
  color: Color.optional(),
});

export async function updateStatus(
  input: z.input<typeof UpdateStatusSchema>,
): Promise<{ ok: true } | ActionError> {
  const parsed = UpdateStatusSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("statuses")
    .select("id, status_set_id")
    .eq("id", parsed.data.statusId)
    .maybeSingle();
  if (!row) return { error: "Status not found" };
  const ctx = await gateForSet(row.status_set_id);
  if ("error" in ctx) return ctx;

  const rows = await setRows(supabase, row.status_set_id);
  const next = rows.map((r) =>
    r.id === row.id
      ? {
          ...r,
          name: parsed.data.name ?? r.name,
          category: parsed.data.category ?? r.category,
          is_blocked: parsed.data.isBlocked ?? r.is_blocked,
          color: parsed.data.color ?? r.color,
        }
      : r,
  );
  const me = next.find((r) => r.id === row.id)!;
  // Leaving `active` drops the blocked flag silently — it has no meaning there.
  if (me.category !== "active") me.is_blocked = false;
  const problems = validateSet(next);
  if (problems.length) return { error: problemMessage(problems[0]) };

  const { error } = await supabase
    .from("statuses")
    .update({
      name: me.name,
      category: me.category,
      is_blocked: me.is_blocked,
      color: me.color,
    })
    .eq("id", row.id);
  if (error) return { error: error.message };

  // A category change leaves every task of this status with a stale legacy
  // projection + completed_at; a no-op status_id write re-runs the resolver.
  if (parsed.data.category || parsed.data.isBlocked !== undefined) {
    await supabase.from("tasks").update({ status_id: row.id }).eq("status_id", row.id);
  }
  return { ok: true };
}

/**
 * Delete a status. Its tasks move to `moveTasksTo`, else to the closest
 * remaining status of the set (category + blocked). The DB guard refuses
 * removing the only open / closed status; the rules say so first.
 */
export async function deleteStatus(input: {
  statusId: string;
  moveTasksTo?: string | null;
}): Promise<{ ok: true; moved: number } | ActionError> {
  const id = Uuid.safeParse(input.statusId);
  if (!id.success) return { error: "Invalid status" };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("statuses")
    .select("id, status_set_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!row) return { error: "Status not found" };
  const ctx = await gateForSet(row.status_set_id);
  if ("error" in ctx) return ctx;

  const rows = await setRows(supabase, row.status_set_id);
  const blocker = deleteBlocker(rows, row.id);
  if (blocker) return { error: blocker };
  const target =
    (input.moveTasksTo && rows.find((r) => r.id === input.moveTasksTo)) ||
    fallbackFor(rows, row.id);
  if (!target || target.id === row.id) return { error: "Nowhere to move its tasks" };

  const { data: moved, error: moveErr } = await supabase
    .from("tasks")
    .update({ status_id: target.id })
    .eq("status_id", row.id)
    .select("id");
  if (moveErr) return { error: moveErr.message };
  const { error } = await supabase.from("statuses").delete().eq("id", row.id);
  if (error) return { error: error.message };
  return { ok: true, moved: moved?.length ?? 0 };
}

export async function reorderStatuses(input: {
  setId: string;
  orderedIds: string[];
}): Promise<{ ok: true } | ActionError> {
  const parsed = z
    .object({ setId: Uuid, orderedIds: z.array(Uuid).min(1).max(64) })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await gateForSet(parsed.data.setId);
  if ("error" in ctx) return ctx;
  const { supabase, set } = ctx;
  const rows = await setRows(supabase, set.id);
  const known = new Set(rows.map((r) => r.id));
  const ids = parsed.data.orderedIds.filter((x) => known.has(x));
  const positions = ladder(ids);
  const results = await Promise.all(
    ids.map((x) =>
      supabase.from("statuses").update({ position: positions[x] }).eq("id", x),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  return { ok: true };
}

/**
 * "Customise this list's statuses": copy the inherited set into a set the
 * list owns (named after the list), point the list at it, and move every
 * task to the copy of its status (same index — nothing changes category).
 */
export async function forkListStatuses(
  listId: string,
): Promise<{ setId: string } | ActionError> {
  const id = Uuid.safeParse(listId);
  if (!id.success) return { error: "Invalid list" };
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("lists")
    .select("id, property_id, name, status_set_id, inherits_statuses")
    .eq("id", id.data)
    .maybeSingle();
  if (!list) return { error: "List not found" };
  const gate = await requireManagement(list.property_id);
  if (!gate.ok) return { error: gate.error };
  if (!list.inherits_statuses) return { setId: list.status_set_id };

  const source = await setRows(supabase, list.status_set_id);
  if (source.length === 0) return { error: "The inherited set is empty" };
  const { rows, indexOf } = forkPlan(source);

  const { data: set, error: setErr } = await supabase
    .from("status_sets")
    .insert({ property_id: list.property_id, name: list.name, created_by: gate.userId })
    .select("id")
    .single();
  if (setErr || !set) return { error: setErr?.message ?? "Could not create set" };

  const { data: inserted, error: insErr } = await supabase
    .from("statuses")
    .insert(
      rows.map((r) => ({
        status_set_id: set.id,
        property_id: list.property_id,
        ...r,
      })),
    )
    .select("id, position")
    .order("position");
  if (insErr || !inserted) return { error: insErr?.message ?? "Could not copy statuses" };

  const { error: listErr } = await supabase
    .from("lists")
    .update({ status_set_id: set.id, inherits_statuses: false })
    .eq("id", list.id);
  if (listErr) return { error: listErr.message };

  // Tasks: old status → the copy at the same index. The resolver would
  // otherwise remap by category on the next touch; this keeps them exact.
  await Promise.all(
    Object.entries(indexOf).map(([oldId, i]) =>
      supabase
        .from("tasks")
        .update({ status_id: inserted[i].id })
        .eq("list_id", list.id)
        .eq("status_id", oldId),
    ),
  );
  return { setId: set.id };
}

/**
 * "Use team statuses" again: point the list back at its scope's set and
 * remap its tasks by category. The list's own set is archived (not deleted)
 * so a change of heart can restore it from SQL; nothing references it.
 */
export async function inheritListStatuses(
  listId: string,
): Promise<{ setId: string } | ActionError> {
  const id = Uuid.safeParse(listId);
  if (!id.success) return { error: "Invalid list" };
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("lists")
    .select("id, property_id, space_id, status_set_id, inherits_statuses")
    .eq("id", id.data)
    .maybeSingle();
  if (!list) return { error: "List not found" };
  const gate = await requireManagement(list.property_id);
  if (!gate.ok) return { error: gate.error };
  if (list.inherits_statuses) return { setId: list.status_set_id };

  // The scope's set: the space chain's default, else the property default.
  let targetSetId: string | null = null;
  if (list.space_id) {
    const { data } = await supabase.rpc("space_status_set", { p_space: list.space_id });
    targetSetId = (data as string | null) ?? null;
  } else {
    const { data } = await supabase
      .from("status_sets")
      .select("id")
      .eq("property_id", list.property_id)
      .eq("is_default", true)
      .maybeSingle();
    targetSetId = data?.id ?? null;
  }
  if (!targetSetId) return { error: "No set to inherit from" };
  if (targetSetId === list.status_set_id) {
    await supabase.from("lists").update({ inherits_statuses: true }).eq("id", list.id);
    return { setId: targetSetId };
  }

  const [from, to] = await Promise.all([
    setRows(supabase, list.status_set_id),
    setRows(supabase, targetSetId),
  ]);
  const plan = remapPlan(from, to);
  const ownSetId = list.status_set_id;

  const { error: listErr } = await supabase
    .from("lists")
    .update({ status_set_id: targetSetId, inherits_statuses: true })
    .eq("id", list.id);
  if (listErr) return { error: listErr.message };
  await Promise.all(
    Object.entries(plan).map(([oldId, newId]) =>
      newId
        ? supabase
            .from("tasks")
            .update({ status_id: newId })
            .eq("list_id", list.id)
            .eq("status_id", oldId)
        : Promise.resolve(),
    ),
  );
  // Nothing else points at the list's own set once it inherits again.
  const { count } = await supabase
    .from("lists")
    .select("id", { count: "exact", head: true })
    .eq("status_set_id", ownSetId);
  if ((count ?? 0) === 0) {
    await supabase
      .from("status_sets")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", ownSetId);
  }
  return { setId: targetSetId };
}

export async function renameStatusSet(input: {
  setId: string;
  name: string;
}): Promise<{ ok: true } | ActionError> {
  const parsed = z.object({ setId: Uuid, name: z.string().trim().min(1).max(80) }).safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await gateForSet(parsed.data.setId);
  if ("error" in ctx) return ctx;
  const { error } = await ctx.supabase
    .from("status_sets")
    .update({ name: parsed.data.name })
    .eq("id", ctx.set.id);
  if (error) return { error: error.message };
  return { ok: true };
}
