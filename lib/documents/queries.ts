import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type {
  DocumentBoardRow,
  DocumentTreeRow,
} from "@/lib/query/section-queries";

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
    // `body_text` powers the page-thumbnail cards on the docs-home boards
    // (see `DocCard` in `doc-boards-section.tsx`); cards slice it client-side
    // to ~240 chars. Written by the Liveblocks ydocUpdated webhook —
    // see `lib/documents/snapshot.ts`. Full text isn't huge in practice
    // (kB range per doc) and a single round-trip beats 50 Liveblocks rooms.
    .select(
      "id, title, updated_at, body_text, created_at, created_by, last_edited_by",
    )
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
    .select(
      "id, title, parent_id, position, updated_at, last_edited_by, kind, source, source_workflow_id, source_workflow_run_id",
    )
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentTreeRow[];
}

/**
 * All boards for a property with their (document_id, position) items inlined.
 * Drives the Boards strip at the top of `<DocumentsHome>`. Position-ordered
 * across boards; items inside each board are sorted client-side because
 * Supabase's nested ordering API is finicky and the lists are tiny.
 */
export async function getDocumentBoards(
  supabase: ServerClient,
  propertyId: string,
): Promise<DocumentBoardRow[]> {
  const { data, error } = await supabase
    .from("document_boards")
    .select(
      "id, name, color, position, created_at, updated_at, created_by, items:document_board_items(document_id, position, created_at)",
    )
    .eq("property_id", propertyId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  // Cast through `unknown`: the generated `Database` type doesn't declare a
  // foreign-key relationship for the embedded `document_board_items` join, so
  // supabase-js types `items` as a `SelectQueryError`. PostgREST resolves the
  // join fine at runtime via the on-FK between board_id and document_boards.id.
  return (data ?? []) as unknown as DocumentBoardRow[];
}
