"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EntityColor } from "@/lib/db/types";

type ActionError = { error: string };
type Client = SupabaseClient<Database>;

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(40);
const Color = z.enum(["slate", "blue", "green", "amber", "rose", "violet"]);

/**
 * Find-or-create a catalog label by (property, case-insensitive name). Shared by
 * the task-label path (so a task label always has a catalog row + color) and the
 * document-label create flow. Returns the label id.
 */
export async function upsertLabel(
  supabase: Client,
  propertyId: string,
  name: string,
  userId: string | null,
): Promise<{ id: string } | ActionError> {
  const trimmed = name.trim();
  const { data: existing } = await supabase
    .from("labels")
    .select("id")
    .eq("property_id", propertyId)
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing) return { id: existing.id };

  const { data, error } = await supabase
    .from("labels")
    .insert({ property_id: propertyId, name: trimmed, created_by: userId })
    .select("id")
    .single();
  // A racing insert can still hit the unique index — re-read on conflict.
  if (error) {
    const { data: raced } = await supabase
      .from("labels")
      .select("id")
      .eq("property_id", propertyId)
      .ilike("name", trimmed)
      .maybeSingle();
    if (raced) return { id: raced.id };
    return { error: error.message };
  }
  return { id: data.id };
}

export async function createLabel(
  propertyId: string,
  name: string,
): Promise<{ id: string } | ActionError> {
  const pid = Uuid.safeParse(propertyId);
  const parsedName = Name.safeParse(name);
  if (!pid.success) return { error: "Invalid property" };
  if (!parsedName.success) return { error: "Label name is required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const res = await upsertLabel(supabase, pid.data, parsedName.data, user.id);
  if ("error" in res) return res;
  revalidatePath(`/p/${pid.data}`);
  return { id: res.id };
}

export async function renameLabel(
  labelId: string,
  name: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(labelId);
  const parsedName = Name.safeParse(name);
  if (!id.success) return { error: "Invalid label" };
  if (!parsedName.success) return { error: "Label name is required" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("labels")
    .update({ name: parsedName.data })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setLabelColor(
  labelId: string,
  color: EntityColor,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(labelId);
  const parsedColor = Color.safeParse(color);
  if (!id.success) return { error: "Invalid label" };
  if (!parsedColor.success) return { error: "Invalid color" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("labels")
    .update({ color: parsedColor.data })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteLabel(
  labelId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(labelId);
  if (!id.success) return { error: "Invalid label" };
  const supabase = await createClient();
  const { error } = await supabase.from("labels").delete().eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
}

/* ── Document labels ─────────────────────────────────────────────────────── */

export async function addDocumentLabel(
  documentId: string,
  labelId: string,
): Promise<{ ok: true } | ActionError> {
  const docId = Uuid.safeParse(documentId);
  const lid = Uuid.safeParse(labelId);
  if (!docId.success || !lid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("document_labels")
    .insert({
      document_id: docId.data,
      label_id: lid.data,
      created_by: user?.id ?? null,
    });
  if (error) {
    if (error.code === "23505") return { ok: true }; // already applied
    return { error: error.message };
  }
  return { ok: true };
}

export async function removeDocumentLabel(
  documentId: string,
  labelId: string,
): Promise<{ ok: true } | ActionError> {
  const docId = Uuid.safeParse(documentId);
  const lid = Uuid.safeParse(labelId);
  if (!docId.success || !lid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_labels")
    .delete()
    .eq("document_id", docId.data)
    .eq("label_id", lid.data);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Create a label (find-or-create) and apply it to a document in one call — used
 * by the doc label picker's "Create" affordance.
 */
export async function createAndAddDocumentLabel(
  propertyId: string,
  documentId: string,
  name: string,
): Promise<{ ok: true; labelId: string } | ActionError> {
  const created = await createLabel(propertyId, name);
  if ("error" in created) return created;
  const applied = await addDocumentLabel(documentId, created.id);
  if ("error" in applied) return applied;
  return { ok: true, labelId: created.id };
}

/* ── Project labels ──────────────────────────────────────────────────────── */

export async function addProjectLabel(
  projectId: string,
  labelId: string,
): Promise<{ ok: true } | ActionError> {
  const pid = Uuid.safeParse(projectId);
  const lid = Uuid.safeParse(labelId);
  if (!pid.success || !lid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("project_labels").insert({
    project_id: pid.data,
    label_id: lid.data,
    created_by: user?.id ?? null,
  });
  if (error) {
    if (error.code === "23505") return { ok: true };
    return { error: error.message };
  }
  return { ok: true };
}

export async function removeProjectLabel(
  projectId: string,
  labelId: string,
): Promise<{ ok: true } | ActionError> {
  const pid = Uuid.safeParse(projectId);
  const lid = Uuid.safeParse(labelId);
  if (!pid.success || !lid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_labels")
    .delete()
    .eq("project_id", pid.data)
    .eq("label_id", lid.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function createAndAddProjectLabel(
  propertyId: string,
  projectId: string,
  name: string,
): Promise<{ ok: true; labelId: string } | ActionError> {
  const created = await createLabel(propertyId, name);
  if ("error" in created) return created;
  const applied = await addProjectLabel(projectId, created.id);
  if ("error" in applied) return applied;
  return { ok: true, labelId: created.id };
}

/* ── Space labels ────────────────────────────────────────────────────────── */

export async function addSpaceLabel(
  spaceId: string,
  labelId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const lid = Uuid.safeParse(labelId);
  if (!sid.success || !lid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("space_labels").insert({
    space_id: sid.data,
    label_id: lid.data,
    created_by: user?.id ?? null,
  });
  if (error) {
    if (error.code === "23505") return { ok: true };
    return { error: error.message };
  }
  return { ok: true };
}

export async function removeSpaceLabel(
  spaceId: string,
  labelId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const lid = Uuid.safeParse(labelId);
  if (!sid.success || !lid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("space_labels")
    .delete()
    .eq("space_id", sid.data)
    .eq("label_id", lid.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function createAndAddSpaceLabel(
  propertyId: string,
  spaceId: string,
  name: string,
): Promise<{ ok: true; labelId: string } | ActionError> {
  const created = await createLabel(propertyId, name);
  if ("error" in created) return created;
  const applied = await addSpaceLabel(spaceId, created.id);
  if ("error" in applied) return applied;
  return { ok: true, labelId: created.id };
}
