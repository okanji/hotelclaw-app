"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

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

async function teamPropertyId(
  supabase: Client,
  teamId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("teams")
    .select("property_id")
    .eq("id", teamId)
    .maybeSingle();
  return data?.property_id ?? null;
}

async function nextPosition(
  supabase: Client,
  table: "teams" | "projects",
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

/* ── Teams ───────────────────────────────────────────────────────────────── */

export async function createTeam(
  propertyId: string,
  name: string,
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

  const position = await nextPosition(supabase, "teams", pid.data);
  const { data, error } = await supabase
    .from("teams")
    .insert({
      property_id: pid.data,
      name: parsedName.data,
      position,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create team" };

  revalidatePath(`/p/${pid.data}/projects`);
  return { id: data.id };
}

export async function renameTeam(
  teamId: string,
  name: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(teamId);
  const parsedName = Name.safeParse(name);
  if (!id.success) return { error: "Invalid team" };
  if (!parsedName.success) return { error: "Name is required" };

  const supabase = await createClient();
  const propertyId = await teamPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Team not found" };

  const { error } = await supabase
    .from("teams")
    .update({ name: parsedName.data })
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  return { ok: true };
}

export async function archiveTeam(
  teamId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(teamId);
  if (!id.success) return { error: "Invalid team" };

  const supabase = await createClient();
  const propertyId = await teamPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Team not found" };

  const { error } = await supabase
    .from("teams")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/projects`);
  return { ok: true };
}

/* ── Projects ────────────────────────────────────────────────────────────── */

export async function createProject(
  propertyId: string,
  name: string,
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
  return { ok: true };
}

export async function setProjectTeams(
  projectId: string,
  teamIds: string[],
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(projectId);
  if (!id.success) return { error: "Invalid project" };
  const ids = z.array(Uuid).safeParse(teamIds);
  if (!ids.success) return { error: "Invalid teams" };

  const supabase = await createClient();
  const propertyId = await projectPropertyId(supabase, id.data);
  if (!propertyId) return { error: "Project not found" };

  // Replace the membership set: clear, then insert the new rows.
  await supabase.from("project_teams").delete().eq("project_id", id.data);
  if (ids.data.length > 0) {
    const { error } = await supabase.from("project_teams").insert(
      ids.data.map((teamId) => ({ project_id: id.data, team_id: teamId })),
    );
    if (error) return { error: error.message };
  }
  revalidatePath(`/p/${propertyId}/projects`);
  return { ok: true };
}

/* ── Assigning work to a team / project ──────────────────────────────────── */

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

export async function setTaskTeam(
  taskId: string,
  teamId: string | null,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(taskId);
  if (!id.success) return { error: "Invalid task" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ team_id: teamId })
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
