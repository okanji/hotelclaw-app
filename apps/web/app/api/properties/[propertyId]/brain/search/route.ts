import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBrainTool, resolvePropertyBrain } from "@/lib/brain/client";
import { resolveMirrorTitles } from "@/lib/brain/browse";

// Hybrid search on the shared serve measures ~21s against the live fleet
// (2026-08-06 audit) — the 30s transport default leaves almost no margin,
// and a timeout here reads to the caller as "the brain knows nothing".
const SEARCH_TIMEOUT_MS = 60_000;

/**
 * `POST /api/properties/:propertyId/brain/search` — { query, limit? }
 *
 * Member-gated brain search for client-registered AI tools (the calendar
 * copilot's `search-property-brain`). The brain credential is property-
 * scoped server-side; the explicit membership check is the gate — brain
 * calls don't go through RLS.
 */
export async function POST(
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
  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("property_id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    query?: string;
    limit?: number;
  } | null;
  const query = (body?.query ?? "").trim();
  if (query.length < 2 || query.length > 300) {
    return NextResponse.json({ error: "query must be 2-300 chars" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Math.trunc(body?.limit ?? 5), 1), 10);

  const binding = await resolvePropertyBrain(propertyId);
  if (!binding) {
    return NextResponse.json({ unavailable: true, reason: "no brain provisioned" });
  }
  const result = await callBrainTool(
    binding,
    "search",
    { query, limit },
    { timeoutMs: SEARCH_TIMEOUT_MS },
  );
  if (!result.ok) {
    return NextResponse.json({ unavailable: true, reason: result.reason });
  }
  // Mirror pages can carry a slug-derived title from the serve; the app row
  // is canonical, so show the document's real title.
  const results = Array.isArray(result.content)
    ? await resolveMirrorTitles(
        propertyId,
        result.content as Array<{ slug: string; title?: string }>,
      )
    : result.content;
  return NextResponse.json({ results });
}
