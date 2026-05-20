import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { DocumentTreeRow } from "@/lib/query/section-queries";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A property's active (non-archived) documents, most-recently-updated first.
 *
 * Shared by `GET /api/properties/[propertyId]/documents` and the server-side
 * prefetch in `documents/page.tsx` — same shape under `["documents", id]`.
 */
export async function getDocuments(supabase: ServerClient, propertyId: string) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, updated_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** A single row of the documents index list. */
export type DocumentListItem = Awaited<
  ReturnType<typeof getDocuments>
>[number];

/**
 * Flat, position-ordered set of a property's active documents — the exact
 * shape `documentsTreeQueryOptions` reads on the client. Shared by the docs
 * layout's server prefetch so a hard load of `/documents/[id]` doesn't race
 * the editor's `useQuery` against a cold cache (which would either flash the
 * skeleton or — if the new doc hasn't been inserted into the cache yet —
 * trip `notFound()` in `DocumentEditor`).
 */
export async function getDocumentsTree(
  supabase: ServerClient,
  propertyId: string,
): Promise<DocumentTreeRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, parent_id, position, updated_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentTreeRow[];
}
