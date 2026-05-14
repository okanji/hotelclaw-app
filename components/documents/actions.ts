"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PropertyId = z.string().uuid();
const DocumentId = z.string().uuid();
const Title = z.string().min(1).max(200);

type ActionError = { error: string };

/**
 * Create a blank document in a property. Returns the new id so the caller
 * can navigate to `/p/<propertyId>/documents/<id>`. The actual Yjs document
 * is created on first connect to the Liveblocks room — no server-side init
 * needed here.
 */
export async function createDocument(
  propertyId: string,
): Promise<{ id: string } | ActionError> {
  const parsed = PropertyId.safeParse(propertyId);
  if (!parsed.success) return { error: "Invalid property id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("documents")
    .insert({ property_id: parsed.data, created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  revalidatePath(`/p/${parsed.data}/documents`);
  return { id: data.id };
}

export async function renameDocument(
  documentId: string,
  title: string,
): Promise<{ ok: true } | ActionError> {
  const id = DocumentId.safeParse(documentId);
  const t = Title.safeParse(title);
  if (!id.success) return { error: "Invalid document id" };
  if (!t.success) return { error: "Title must be 1–200 characters" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("documents")
    .update({ title: t.data })
    .eq("id", id.data)
    .select("property_id")
    .single();
  if (error || !data) return { error: error?.message ?? "Update failed" };

  revalidatePath(`/p/${data.property_id}/documents`);
  revalidatePath(`/p/${data.property_id}/documents/${id.data}`);
  return { ok: true };
}

export async function archiveDocument(
  documentId: string,
): Promise<{ ok: true } | ActionError> {
  const id = DocumentId.safeParse(documentId);
  if (!id.success) return { error: "Invalid document id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data)
    .select("property_id")
    .single();
  if (error || !data) return { error: error?.message ?? "Archive failed" };

  revalidatePath(`/p/${data.property_id}/documents`);
  return { ok: true };
}

export async function restoreDocument(
  documentId: string,
): Promise<{ ok: true } | ActionError> {
  const id = DocumentId.safeParse(documentId);
  if (!id.success) return { error: "Invalid document id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("documents")
    .update({ archived_at: null })
    .eq("id", id.data)
    .select("property_id")
    .single();
  if (error || !data) return { error: error?.message ?? "Restore failed" };

  revalidatePath(`/p/${data.property_id}/documents`);
  return { ok: true };
}
