"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LABEL_COLORS } from "@/components/labels/label-tokens";
import type { EntityColor } from "@/lib/db/types";

/**
 * Lists (migration 0114) — the ClickUp List level between a team and its
 * tasks. Any full member can create / rename / archive a list (RLS: `lists`
 * is `for all` to members); the status-set editor is management-only and
 * lives in `status-actions.ts`.
 *
 * Writes go through the RLS client, so tenancy is the policy, not this file.
 */

type ActionError = { error: string };
const Uuid = z.string().uuid();
const Color = z.enum(LABEL_COLORS as [EntityColor, ...EntityColor[]]);

const CreateListSchema = z.object({
  propertyId: Uuid,
  /** null = a property-level list (beside "General"). */
  spaceId: Uuid.nullable(),
  name: z.string().trim().min(1).max(80),
  color: Color.default("slate"),
  icon: z.string().max(4).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

/**
 * A new list inherits the pipeline of its scope's DEFAULT list (the space's
 * "Tasks" or the property's "General"), which is exactly what the DB does
 * for a new space's default list. The editor can fork it later.
 */
export async function createList(
  input: z.input<typeof CreateListSchema>,
): Promise<{ id: string } | ActionError> {
  const parsed = CreateListSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { propertyId, spaceId, name, color, icon, description } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  let q = supabase
    .from("lists")
    .select("status_set_id")
    .eq("property_id", propertyId)
    .eq("is_default", true)
    .is("archived_at", null);
  q = spaceId ? q.eq("space_id", spaceId) : q.is("space_id", null);
  const { data: scopeDefault } = await q.maybeSingle();
  if (!scopeDefault) return { error: "That team has no default list yet" };

  const { data: last } = await supabase
    .from("lists")
    .select("position")
    .eq("property_id", propertyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("lists")
    .insert({
      property_id: propertyId,
      space_id: spaceId,
      name,
      color,
      icon: icon ?? null,
      description: description ?? null,
      position: (last?.position ?? 0) + 1024,
      status_set_id: scopeDefault.status_set_id,
      inherits_statuses: true,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create list" };
  return { id: data.id };
}

const UpdateListSchema = z.object({
  listId: Uuid,
  name: z.string().trim().min(1).max(80).optional(),
  color: Color.optional(),
  icon: z.string().max(4).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

export async function updateList(
  input: z.input<typeof UpdateListSchema>,
): Promise<{ ok: true } | ActionError> {
  const parsed = UpdateListSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { listId, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from("lists").update(patch).eq("id", listId);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Archive a list. A list with OPEN tasks refuses unless `moveTasksTo` names
 * another live list of the same property — the tasks move first (the 0114
 * resolver remaps their statuses by category), then the list is archived.
 * The default list of a scope can't be archived; archive the team instead.
 */
export async function archiveList(input: {
  listId: string;
  moveTasksTo?: string | null;
}): Promise<
  { ok: true; moved: number } | { needsMove: number } | ActionError
> {
  const id = Uuid.safeParse(input.listId);
  if (!id.success) return { error: "Invalid list" };
  const target = input.moveTasksTo ? Uuid.safeParse(input.moveTasksTo) : null;
  if (target && !target.success) return { error: "Invalid target list" };

  const supabase = await createClient();
  const { data: list } = await supabase
    .from("lists")
    .select("id, property_id, is_default, archived_at")
    .eq("id", id.data)
    .maybeSingle();
  if (!list) return { error: "List not found" };
  if (list.is_default) {
    return { error: "A team's default list can't be archived — archive the team instead." };
  }

  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("list_id", id.data)
    .is("archived_at", null)
    .is("completed_at", null);
  const open = count ?? 0;

  let moved = 0;
  if (open > 0) {
    if (!target) return { needsMove: open };
    const { data: dest } = await supabase
      .from("lists")
      .select("id")
      .eq("id", target.data)
      .eq("property_id", list.property_id)
      .is("archived_at", null)
      .maybeSingle();
    if (!dest) return { error: "Target list not found" };
    // Move EVERY task of the list (done ones too) so nothing is stranded in
    // an archived container. Status remap by category is the resolver's job.
    const { data: movedRows, error: moveErr } = await supabase
      .from("tasks")
      .update({ list_id: dest.id })
      .eq("list_id", id.data)
      .select("id");
    if (moveErr) return { error: moveErr.message };
    moved = movedRows?.length ?? 0;
  }

  const { error } = await supabase
    .from("lists")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true, moved };
}

export async function restoreList(
  listId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(listId);
  if (!id.success) return { error: "Invalid list" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("lists")
    .update({ archived_at: null })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}
