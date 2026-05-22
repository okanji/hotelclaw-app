import "server-only";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** One match from the keyword document search. */
export type DocumentSearchHit = {
  id: string;
  title: string;
  /** First ~240 chars of the doc body — already truncated server-side. */
  preview: string;
  updated_at: string;
  /** `ts_rank_cd` score from the search RPC; only useful for sorting. */
  rank: number;
};

/**
 * Run the `search_documents_keyword` RPC for a property. RLS on `documents`
 * keeps the call scoped to the caller's memberships, so we can pass the
 * `propertyId` straight through — the RPC is `security invoker`. Returns
 * `[]` for blank queries so the UI doesn't have to special-case them.
 *
 * `match_count` clamps server-side to 50 (see migration 0019); higher
 * values silently cap rather than erroring.
 */
export async function searchDocumentsKeyword(
  supabase: ServerClient,
  propertyId: string,
  query: string,
  matchCount = 20,
): Promise<DocumentSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { data, error } = await supabase.rpc("search_documents_keyword", {
    property_id_param: propertyId,
    query_text: trimmed,
    match_count: matchCount,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentSearchHit[];
}
