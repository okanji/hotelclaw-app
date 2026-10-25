"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(200);
/** `YYYY-MM-DD` — a target is a day, not an instant. */
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const POSITION_GAP = 1024;
const COLORS = ["slate", "blue", "green", "amber", "rose", "violet"] as const;

/**
 * Initiatives (migration 0111) — the planning layer above projects. Every
 * write runs on the caller's own RLS session (members read/write), so the
 * `initiatives_log_activity` trigger attributes it to the person.
 */
export async function createInitiative(input: {
  propertyId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: (typeof COLORS)[number];
  status?: "planned" | "active" | "completed";
  ownerId?: string | null;
  leadSpaceId?: string | null;
  targetDate?: string | null;
}): Promise<{ id: string } | ActionError> {
  const parsed = z
    .object({
      propertyId: Uuid,
      name: Name,
      description: z.string().trim().max(20000).nullable().optional(),
      icon: z.string().trim().max(8).nullable().optional(),
      color: z.enum(COLORS).optional(),
      status: z.enum(["planned", "active", "completed"]).optional(),
      ownerId: Uuid.nullable().optional(),
      leadSpaceId: Uuid.nullable().optional(),
      targetDate: DateOnly.nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const v = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: last } = await supabase
    .from("initiatives")
    .select("position")
    .eq("property_id", v.propertyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("initiatives")
    .insert({
      property_id: v.propertyId,
      name: v.name,
      description: v.description || null,
      icon: v.icon || null,
      color: v.color ?? "violet",
      status: v.status ?? "planned",
      // The creator owns it until someone says otherwise — an initiative
      // nobody is accountable for is the failure Linear's Owner column exists
      // to prevent.
      owner_id: v.ownerId === undefined ? user.id : v.ownerId,
      lead_space_id: v.leadSpaceId ?? null,
      target_date: v.targetDate ?? null,
      position: (last?.position ?? 0) + POSITION_GAP,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create initiative" };
  return { id: data.id };
}

const InitiativePatch = z.object({
  name: Name.optional(),
  description: z.string().trim().max(20000).nullable().optional(),
  icon: z.string().trim().max(8).nullable().optional(),
  color: z.enum(COLORS).optional(),
  status: z.enum(["planned", "active", "completed"]).optional(),
  owner_id: Uuid.nullable().optional(),
  lead_space_id: Uuid.nullable().optional(),
  target_date: DateOnly.nullable().optional(),
});

export async function updateInitiative(
  initiativeId: string,
  patch: z.input<typeof InitiativePatch>,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(initiativeId);
  if (!id.success) return { error: "Invalid initiative" };
  const parsed = InitiativePatch.safeParse(patch);
  if (!parsed.success) return { error: "Invalid input" };
  if (Object.keys(parsed.data).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("initiatives")
    .update(parsed.data)
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Soft-archive (or restore with `archived: false`). Links are kept. */
export async function archiveInitiative(
  initiativeId: string,
  archived = true,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(initiativeId);
  if (!id.success) return { error: "Invalid initiative" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("initiatives")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Link a project to an initiative. Both rows are re-read through RLS and must
 * sit in the same property — the link row's `property_id` is the tenancy
 * fence, so it is taken from the initiative, never the caller.
 */
export async function linkInitiativeProject(
  initiativeId: string,
  projectId: string,
): Promise<{ ok: true } | ActionError> {
  const ids = z.object({ i: Uuid, p: Uuid }).safeParse({ i: initiativeId, p: projectId });
  if (!ids.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const [ini, proj, last] = await Promise.all([
    supabase.from("initiatives").select("property_id").eq("id", ids.data.i).maybeSingle(),
    supabase.from("projects").select("property_id").eq("id", ids.data.p).maybeSingle(),
    supabase
      .from("initiative_projects")
      .select("position")
      .eq("initiative_id", ids.data.i)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!ini.data) return { error: "Initiative not found" };
  if (!proj.data || proj.data.property_id !== ini.data.property_id)
    return { error: "Project not found" };

  const { error } = await supabase.from("initiative_projects").upsert(
    {
      initiative_id: ids.data.i,
      project_id: ids.data.p,
      property_id: ini.data.property_id,
      position: (last.data?.position ?? 0) + POSITION_GAP,
    },
    { onConflict: "initiative_id,project_id", ignoreDuplicates: true },
  );
  if (error) return { error: error.message };
  return { ok: true };
}

export async function unlinkInitiativeProject(
  initiativeId: string,
  projectId: string,
): Promise<{ ok: true } | ActionError> {
  const ids = z.object({ i: Uuid, p: Uuid }).safeParse({ i: initiativeId, p: projectId });
  if (!ids.success) return { error: "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("initiative_projects")
    .delete()
    .eq("initiative_id", ids.data.i)
    .eq("project_id", ids.data.p);
  if (error) return { error: error.message };
  return { ok: true };
}
