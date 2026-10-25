"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createNotifications } from "@/lib/notifications/server";
import type { ProjectUpdatePayload } from "@/lib/notifications/types";

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Health = z.enum(["on_track", "at_risk", "off_track"]);
const Body = z.string().trim().max(20000);
const Target = z.object({ kind: z.enum(["project", "initiative"]), id: Uuid });

const EXCERPT_CHARS = 140;

function excerpt(body: string): string | null {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat;
}

/**
 * Post a written status update (Linear's "Write project update") on a project
 * or an initiative. The insert runs on the caller's RLS session — the policy
 * pins `author_id = auth.uid()` — and the `project_updates_log_activity`
 * trigger writes the `update_posted` activity row.
 *
 * Then the people accountable hear about it: for a project, its lead plus the
 * owners of every live initiative it serves; for an initiative, its owner.
 * The author is never notified of their own post. Notification delivery is
 * fail-soft (`createNotifications` never throws).
 */
export async function postProjectUpdate(input: {
  target: { kind: "project" | "initiative"; id: string };
  health: "on_track" | "at_risk" | "off_track";
  body: string;
}): Promise<{ id: string } | ActionError> {
  const parsed = z
    .object({ target: Target, health: Health, body: Body })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { target, health, body } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  let propertyId: string;
  let entityName: string;
  const recipients = new Set<string>();

  if (target.kind === "project") {
    const { data: project } = await supabase
      .from("projects")
      .select("property_id, name, lead_user_id")
      .eq("id", target.id)
      .maybeSingle();
    if (!project) return { error: "Project not found" };
    propertyId = project.property_id;
    entityName = project.name;
    if (project.lead_user_id) recipients.add(project.lead_user_id);

    const { data: links } = await supabase
      .from("initiative_projects")
      .select("initiative_id")
      .eq("project_id", target.id);
    const initiativeIds = (links ?? []).map((l) => l.initiative_id);
    if (initiativeIds.length > 0) {
      const { data: owners } = await supabase
        .from("initiatives")
        .select("owner_id")
        .in("id", initiativeIds)
        .is("archived_at", null);
      for (const o of owners ?? []) if (o.owner_id) recipients.add(o.owner_id);
    }
  } else {
    const { data: initiative } = await supabase
      .from("initiatives")
      .select("property_id, name, owner_id")
      .eq("id", target.id)
      .maybeSingle();
    if (!initiative) return { error: "Initiative not found" };
    propertyId = initiative.property_id;
    entityName = initiative.name;
    if (initiative.owner_id) recipients.add(initiative.owner_id);
  }

  const { data, error } = await supabase
    .from("project_updates")
    .insert({
      property_id: propertyId,
      project_id: target.kind === "project" ? target.id : null,
      initiative_id: target.kind === "initiative" ? target.id : null,
      author_id: user.id,
      health,
      body,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not post update" };

  recipients.delete(user.id);
  if (recipients.size > 0) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    const payload: ProjectUpdatePayload = {
      updateId: data.id,
      ...(target.kind === "project"
        ? { projectId: target.id }
        : { initiativeId: target.id }),
      entityName,
      health,
      excerpt: excerpt(body),
      byUserId: user.id,
      byUserName: profile?.full_name ?? user.email ?? null,
    };
    await createNotifications(
      [...recipients].map((userId) => ({
        userId,
        propertyId,
        type: "project_update" as const,
        payload,
      })),
    );
  }

  return { id: data.id };
}

/** Edit your own update (RLS rejects anyone else's — 0 rows, reported). */
export async function editProjectUpdate(
  updateId: string,
  patch: { health?: "on_track" | "at_risk" | "off_track"; body?: string },
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(updateId);
  if (!id.success) return { error: "Invalid update" };
  const parsed = z
    .object({ health: Health.optional(), body: Body.optional() })
    .safeParse(patch);
  if (!parsed.success) return { error: "Invalid input" };
  if (Object.keys(parsed.data).length === 0) return { ok: true };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_updates")
    .update(parsed.data)
    .eq("id", id.data)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You can only edit your own updates" };
  return { ok: true };
}

export async function deleteProjectUpdate(
  updateId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(updateId);
  if (!id.success) return { error: "Invalid update" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_updates")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You can only delete your own updates" };
  return { ok: true };
}
