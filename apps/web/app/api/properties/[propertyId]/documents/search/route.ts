import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchDocumentsKeyword } from "@/lib/documents/search";

const MAX_QUERY_CHARS = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Keyword document search, scoped to a property.
 *
 *   GET /api/properties/<id>/documents/search?q=<query>&limit=<n>
 *
 * Backed by the `search_documents_keyword` Postgres RPC (migration 0019),
 * which runs as `security invoker` so the existing RLS on `documents`
 * enforces tenant isolation — no extra membership check needed here beyond
 * the standard "must be signed in".
 *
 * Returns `{ results: DocumentSearchHit[] }`. A blank `q` returns an empty
 * array (not a 400) so the consumer can fire-and-forget on every keystroke.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, MAX_QUERY_CHARS);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || 0, 1),
    MAX_LIMIT,
  );

  try {
    const results = await searchDocumentsKeyword(supabase, propertyId, q, limit);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "search failed" },
      { status: 500 },
    );
  }
}
