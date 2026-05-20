"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PropertyId = z.string().uuid();
const DocumentId = z.string().uuid();
const Title = z.string().min(1).max(200);
// Body snippet cap matches the column comment in migration 0014. The editor
// already slices client-side; the server check is a belt-and-braces guard
// against a misbehaving client.
const BodySnippet = z.string().max(1000);

type ActionError = { error: string };

/** Sparse-float gap between siblings — see migration 0010/0012. */
const POSITION_GAP = 1024;

/**
 * Next sibling position: append after the current last child of `parentId`
 * (or the last top-level doc when `parentId` is null).
 */
async function nextPosition(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  parentId: string | null,
): Promise<number> {
  let query = supabase
    .from("documents")
    .select("position")
    .eq("property_id", propertyId);
  query = parentId
    ? query.eq("parent_id", parentId)
    : query.is("parent_id", null);

  const { data } = await query
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.position ?? 0) + POSITION_GAP;
}

/**
 * Create a blank document in a property, optionally nested under `parentId`.
 * Returns the new id so the caller can navigate to
 * `/p/<propertyId>/documents/<id>`. The Yjs document is created on first
 * connect to the Liveblocks room — no server-side init needed here.
 */
export async function createDocument(
  propertyId: string,
  parentId?: string | null,
): Promise<{ id: string } | ActionError> {
  const parsed = PropertyId.safeParse(propertyId);
  if (!parsed.success) return { error: "Invalid property id" };

  let parent: string | null = null;
  if (parentId) {
    const p = DocumentId.safeParse(parentId);
    if (!p.success) return { error: "Invalid parent document id" };
    parent = p.data;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Guard tenancy: a parent must live in the same property as the new child.
  if (parent) {
    const { data: parentRow } = await supabase
      .from("documents")
      .select("property_id, archived_at")
      .eq("id", parent)
      .maybeSingle();
    if (!parentRow || parentRow.property_id !== parsed.data) {
      return { error: "Parent document not found" };
    }
    if (parentRow.archived_at) {
      return { error: "Cannot nest under an archived document" };
    }
  }

  const position = await nextPosition(supabase, parsed.data, parent);

  const { data, error } = await supabase
    .from("documents")
    .insert({
      property_id: parsed.data,
      parent_id: parent,
      position,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  revalidatePath(`/p/${parsed.data}/documents`);
  return { id: data.id };
}

/**
 * Mirror the first ~500 chars of a doc's plain-text body into
 * `documents.body_snippet` so the docs-home boards can render page-thumbnail
 * cards without mounting a Liveblocks room per card. Called (debounced) from
 * `useSnippetSync` in `document-editor.tsx`.
 *
 * Best-effort: errors are swallowed by the editor — Yjs owns the real content.
 * No `revalidatePath` here: the docs home reads from React Query, not from RSC
 * caches, so revalidating on every keystroke debounce would be pure overhead.
 */
export async function syncDocumentSnippet(
  documentId: string,
  snippet: string,
): Promise<{ ok: true } | ActionError> {
  const id = DocumentId.safeParse(documentId);
  const s = BodySnippet.safeParse(snippet);
  if (!id.success) return { error: "Invalid document id" };
  if (!s.success) return { error: "Snippet too long" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("documents")
    .update({ body_snippet: s.data })
    .eq("id", id.data);
  if (error) return { error: error.message };
  return { ok: true };
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

/**
 * Re-parent a document — drag-to-nest in the sidebar, or the "Move to…"
 * picker. Passing `parentId: null` moves it back to the top level. The doc is
 * appended to the end of its new parent's child list.
 *
 * Rejects moves that would create a cycle (a doc cannot become a descendant
 * of itself). The whole subtree under the moved doc rides along automatically
 * since only this one row's `parent_id` changes.
 */
export async function moveDocument(
  documentId: string,
  parentId: string | null,
): Promise<{ ok: true } | ActionError> {
  const id = DocumentId.safeParse(documentId);
  if (!id.success) return { error: "Invalid document id" };

  let parent: string | null = null;
  if (parentId) {
    const p = DocumentId.safeParse(parentId);
    if (!p.success) return { error: "Invalid parent document id" };
    parent = p.data;
  }
  if (parent === id.data) return { error: "A document cannot contain itself" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: doc } = await supabase
    .from("documents")
    .select("property_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!doc) return { error: "Document not found" };

  // Pull the property's parent map once to check the new parent is in-tenant
  // and is not a descendant of the doc being moved.
  const { data: rows } = await supabase
    .from("documents")
    .select("id, parent_id")
    .eq("property_id", doc.property_id);
  const parentOf = new Map((rows ?? []).map((r) => [r.id, r.parent_id]));

  if (parent) {
    if (!parentOf.has(parent)) return { error: "Parent document not found" };
    // Walk ancestors of the target parent — if we meet the doc being moved,
    // the move would form a loop.
    let cursor: string | null = parent;
    while (cursor) {
      if (cursor === id.data) {
        return { error: "Cannot move a document inside one of its sub-pages" };
      }
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  const position = await nextPosition(supabase, doc.property_id, parent);

  const { error } = await supabase
    .from("documents")
    .update({ parent_id: parent, position })
    .eq("id", id.data);
  if (error) return { error: error.message };

  revalidatePath(`/p/${doc.property_id}/documents`);
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

  const { data: doc } = await supabase
    .from("documents")
    .select("property_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!doc) return { error: "Document not found" };

  // Cascades to every sub-page (recursive CTE in the RPC) — see 0012.
  const { error } = await supabase.rpc("archive_document_tree", {
    root: id.data,
  });
  if (error) return { error: error.message };

  revalidatePath(`/p/${doc.property_id}/documents`);
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

  const { data: doc } = await supabase
    .from("documents")
    .select("property_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!doc) return { error: "Document not found" };

  // Restores the subtree; detaches to top level if the old parent is gone.
  const { error } = await supabase.rpc("restore_document_tree", {
    root: id.data,
  });
  if (error) return { error: error.message };

  revalidatePath(`/p/${doc.property_id}/documents`);
  return { ok: true };
}

export type ArchivedDocument = {
  id: string;
  title: string;
  archivedAt: string;
};

/** List a property's archived documents, most recently archived first. */
export async function listArchivedDocuments(
  propertyId: string,
): Promise<{ documents: ArchivedDocument[] } | ActionError> {
  const parsed = PropertyId.safeParse(propertyId);
  if (!parsed.success) return { error: "Invalid property id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("documents")
    .select("id, title, archived_at")
    .eq("property_id", parsed.data)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });
  if (error) return { error: error.message };

  return {
    documents: (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      archivedAt: row.archived_at as string,
    })),
  };
}
