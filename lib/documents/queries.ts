import "server-only";
import type { createClient } from "@/lib/supabase/server";

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
