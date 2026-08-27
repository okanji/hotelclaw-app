import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runDocContextualEdit } from "@/lib/ai/doc-contextual";

/**
 * POST /api/properties/:propertyId/handover/rewrite
 *
 * Selection rewrites for the handover draft editor's SelectionActionsBar.
 * Reuses the document editor's contextual-edit engine (`runDocContextualEdit`
 * — single tool-free low-latency turn, prose in/prose out, type decided
 * server-side); there is no document row here, so auth is just membership.
 */

const Body = z.object({
  prompt: z.string().min(1).max(500),
  context: z.object({
    beforeSelection: z.string().max(20_000),
    selection: z.string().min(1).max(10_000),
    afterSelection: z.string().max(20_000),
  }),
});

export async function POST(
  request: NextRequest,
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
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const result = await runDocContextualEdit(parsed.data);
  return NextResponse.json(result);
}
