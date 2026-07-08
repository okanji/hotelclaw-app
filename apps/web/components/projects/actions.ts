"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EntityColor } from "@/lib/db/types";

type CreateOpts = { color?: EntityColor; icon?: string | null };

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(120);
const POSITION_GAP = 1024;

type Client = SupabaseClient<Database>;

async function projectPropertyId(
  supabase: Client,
  projectId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("property_id")
    .eq("id", projectId)
    .maybeSingle();
  return data?.property_id ?? null;
}

async function spacePropertyId(
  supabase: Client,
  spaceId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("spaces")
    .select("property_id")
    .eq("id", spaceId)
    .maybeSingle();
  return data?.property_id ?? null;
}

async function nextPosition(
  supabase: Client,
  table: "spaces" | "projects",
  propertyId: string,
): Promise<number> {
  const { data } = await supabase
    .from(table)
    .select("position")
    .eq("property_id", propertyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? 0) + POSITION_GAP;
}

/* ── Spaces ───────────────────────────────────────────────────────────────── */

export async function createSpace(
  propertyId: string,
  name: string,
  opts?: CreateOpts,
): Promise<{ id: string } | ActionError> {
  const pid = Uuid.safeParse(propertyId);
  const parsedName = Name.safeParse(name);
  if (!pid.success) return { error: "Invalid property" };
  if (!parsedName.success) return { error: "Name is required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const position = await nextPosition(supabase, "spaces", pid.data);
  const { data, error } = await supabase
    .from("spaces")
    .insert({
      property_id: pid.data,
      name: parsedName.data,
      position,
      created_by: user.id,
      ...(opts?.color ? { color: opts.color } : {}),
      ...(opts?.icon ? { icon: opts.icon } : {}),
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create team" };

  revalidatePath(`/p/${pid.data}/projects`);
  return { id: data.id };
}

export async function renameSpace(
  spaceId: string,
  name: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(spaceId);
  const parsedName = Name.safeParse(name);
  if (!id.success) return { error: "Invalid team" };
  if (!parsedName.success) return { error: "Name is required" };

  const supabase = await createClient();
  const propertyId = await spacePropertyId(supabase, id.data);
  if (!propertyId) return { error: "Team not found" };

  const { error } = await supabase
    .from("spaces")
    .update({ name: parsedName.data })
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  return { ok: true };
}

const SpacePatch = z.object({
  name: Name.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  color: z
    .enum(["slate", "blue", "green", "amber", "rose", "violet"])
    .optional(),
});

export async function updateSpace(
  spaceId: string,
  patch: z.input<typeof SpacePatch>,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(spaceId);
  if (!id.success) return { error: "Invalid team" };
  const parsed = SpacePatch.safeParse(patch);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const propertyId = await spacePropertyId(supabase, id.data);
  if (!propertyId) return { error: "Team not found" };

  const { error } = await supabase
    .from("spaces")
    .update(parsed.data)
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  return { ok: true };
}

export async function archiveSpace(
  spaceId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(spaceId);
  if (!id.success) return { error: "Invalid team" };

  const supabase = await createClient();
  const propertyId = await spacePropertyId(supabase, id.data);
  if (!propertyId) return { error: "Team not found" };

  const { error } = await supabase
    .from("spaces")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  revalidatePath(`/p/${propertyId}/archive`);
  return { ok: true };
}

/** Bring an archived space back (clears `archived_at`). */
export async function restoreSpace(
  spaceId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(spaceId);
  if (!id.success) return { error: "Invalid team" };

  const supabase = await createClient();
  const propertyId = await spacePropertyId(supabase, id.data);
  if (!propertyId) return { error: "Team not found" };

  const { error } = await supabase
    .from("spaces")
    .update({ archived_at: null })
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  revalidatePath(`/p/${propertyId}/archive`);
  return { ok: true };
}

/**
 * Permanently delete a space. Junction rows (members, project links) cascade;
 * tasks/documents in the space have their `space_id` nulled by the FK. No undo
 * — only offered from the archive.
 */
export async function deleteSpace(
  spaceId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(spaceId);
  if (!id.success) return { error: "Invalid team" };

  const supabase = await createClient();
  const propertyId = await spacePropertyId(supabase, id.data);
  if (!propertyId) return { error: "Team not found" };

  const { error } = await supabase.from("spaces").delete().eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  revalidatePath(`/p/${propertyId}/archive`);
  return { ok: true };
}

/* ── Projects ────────────────────────────────────────────────────────────── */

export async function createProject(
  propertyId: string,
  name: string,
  opts?: CreateOpts,
): Promise<{ id: string } | ActionError> {
  const pid = Uuid.safeParse(propertyId);
  const parsedName = Name.safeParse(name);
  if (!pid.success) return { error: "Invalid property" };
  if (!parsedName.success) return { error: "Name is required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const position = await nextPosition(supabase, "projects", pid.data);
  const { data, error } = await supabase
    .from("projects")
    .insert({
      property_id: pid.data,
      name: parsedName.data,
      position,
      created_by: user.id,
      ...(opts?.color ? { color: opts.color } : {}),
      ...(opts?.icon ? { icon: opts.icon } : {}),
    })
    .select("id")
    .single();
  if (error || !data)
    return { error: error?.message ?? "Could not create project" };

  revalidatePath(`/p/${pid.data}/projects`);
  return { id: data.id };
}

const ProjectPatch = z.object({
  name: Name.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["active", "planned", "completed", "archived"]).optional(),
  start_date: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
});

export async function updateProject(
  projectId: string,
  patch: z.input<typeof ProjectPatch>,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(projectId);
  if (!id.success) return { error: "Invalid project" };
  const parsed = ProjectPatch.safeParse(patch);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const propertyId = await projectPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Project not found" };

  const { error } = await supabase
    .from("projects")
    .update(parsed.data)
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  return { ok: true };
}

export async function archiveProject(
  projectId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(projectId);
  if (!id.success) return { error: "Invalid project" };

  const supabase = await createClient();
  const propertyId = await projectPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Project not found" };

  const { error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  revalidatePath(`/p/${propertyId}/archive`);
  return { ok: true };
}

/** Bring an archived project back (clears `archived_at`). */
export async function restoreProject(
  projectId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(projectId);
  if (!id.success) return { error: "Invalid project" };

  const supabase = await createClient();
  const propertyId = await projectPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Project not found" };

  const { error } = await supabase
    .from("projects")
    .update({ archived_at: null })
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  revalidatePath(`/p/${propertyId}/archive`);
  return { ok: true };
}

/**
 * Permanently delete a project. Space links cascade; tasks/documents have their
 * `project_id` nulled by the FK. No undo — only offered from the archive.
 */
export async function deleteProject(
  projectId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(projectId);
  if (!id.success) return { error: "Invalid project" };

  const supabase = await createClient();
  const propertyId = await projectPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Project not found" };

  const { error } = await supabase.from("projects").delete().eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  revalidatePath(`/p/${propertyId}/archive`);
  return { ok: true };
}

export async function setProjectSpaces(
  projectId: string,
  spaceIds: string[],
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(projectId);
  if (!id.success) return { error: "Invalid project" };
  const ids = z.array(Uuid).safeParse(spaceIds);
  if (!ids.success) return { error: "Invalid teams" };

  const supabase = await createClient();
  const propertyId = await projectPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Project not found" };

  // Replace the membership set: clear, then insert the new rows.
  await supabase.from("project_spaces").delete().eq("project_id", id.data);
  if (ids.data.length > 0) {
    const { error } = await supabase.from("project_spaces").insert(
      ids.data.map((spaceId) => ({ project_id: id.data, space_id: spaceId })),
    );
    if (error) return { error: error.message };
  }
  revalidatePath(`/p/${propertyId}/projects`);
  return { ok: true };
}

/* ── Assigning work to a space / project ──────────────────────────────────── */

export async function setTaskProject(
  taskId: string,
  projectId: string | null,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(taskId);
  if (!id.success) return { error: "Invalid task" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ project_id: projectId })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setTaskSpace(
  taskId: string,
  spaceId: string | null,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(taskId);
  if (!id.success) return { error: "Invalid task" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ space_id: spaceId })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setDocumentProject(
  documentId: string,
  projectId: string | null,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(documentId);
  if (!id.success) return { error: "Invalid document" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .update({ project_id: projectId })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setDocumentSpace(
  documentId: string,
  spaceId: string | null,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(documentId);
  if (!id.success) return { error: "Invalid document" };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("documents")
    .select("space_id")
    .eq("id", id.data)
    .maybeSingle();
  const { error } = await supabase
    .from("documents")
    .update({ space_id: spaceId })
    .eq("id", id.data);
  if (error) return { error: error.message };
  if (row?.space_id && row.space_id !== spaceId) {
    await supabase
      .from("space_pinned_resources")
      .delete()
      .eq("space_id", row.space_id)
      .eq("document_id", id.data);
  }
  if (spaceId === null) {
    await supabase
      .from("space_pinned_resources")
      .delete()
      .eq("document_id", id.data);
  }
  return { ok: true };
}

const MAX_SPACE_PINS = 8;

async function nextSpacePinPosition(
  supabase: Client,
  spaceId: string,
): Promise<number> {
  const { data } = await supabase
    .from("space_pinned_resources")
    .select("position")
    .eq("space_id", spaceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? 0) + POSITION_GAP;
}

/** Pin a document on the space overview. Assigns to the space if needed. */
export async function pinSpaceResource(
  spaceId: string,
  documentId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const did = Uuid.safeParse(documentId);
  if (!sid.success || !did.success) return { error: "Invalid id" };

  const supabase = await createClient();
  const propertyId = await spacePropertyId(supabase, sid.data);
  if (!propertyId) return { error: "Team not found" };

  const { count } = await supabase
    .from("space_pinned_resources")
    .select("*", { count: "exact", head: true })
    .eq("space_id", sid.data);
  if ((count ?? 0) >= MAX_SPACE_PINS) {
    return { error: `You can pin up to ${MAX_SPACE_PINS} resources` };
  }

  const { data: doc } = await supabase
    .from("documents")
    .select("property_id, space_id")
    .eq("id", did.data)
    .maybeSingle();
  if (!doc || doc.property_id !== propertyId) {
    return { error: "Document not found" };
  }

  if (doc.space_id !== sid.data) {
    const { error: assignErr } = await supabase
      .from("documents")
      .update({ space_id: sid.data })
      .eq("id", did.data);
    if (assignErr) return { error: assignErr.message };
  }

  const { data: existing } = await supabase
    .from("space_pinned_resources")
    .select("document_id")
    .eq("space_id", sid.data)
    .eq("document_id", did.data)
    .maybeSingle();
  if (existing) return { ok: true };

  const pos = await nextSpacePinPosition(supabase, sid.data);
  const { error } = await supabase.from("space_pinned_resources").insert({
    space_id: sid.data,
    document_id: did.data,
    position: pos,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

/** Remove a document from the space overview pins (keeps space membership). */
export async function unpinSpaceResource(
  spaceId: string,
  documentId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const did = Uuid.safeParse(documentId);
  if (!sid.success || !did.success) return { error: "Invalid id" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("space_pinned_resources")
    .delete()
    .eq("space_id", sid.data)
    .eq("document_id", did.data);
  if (error) return { error: error.message };
  return { ok: true };
}
