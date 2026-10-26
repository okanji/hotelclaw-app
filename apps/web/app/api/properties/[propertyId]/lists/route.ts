import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getStatusCatalog } from "@/lib/tasks/status-catalog";

/**
 * `GET /api/properties/:propertyId/lists` — the property's lists, status
 * sets and statuses (migration 0114). Cookie OR Bearer, so mobile reads the
 * same catalog the web board does; RLS does the scoping.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await getStatusCatalog(supabase, propertyId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load lists" },
      { status: 500 },
    );
  }
}
