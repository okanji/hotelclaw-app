import { NextResponse, type NextRequest } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { AiFeedbackInputSchema, upsertAiFeedback } from "@/lib/ai/feedback";

/**
 * POST /api/properties/:propertyId/ai-feedback — thumbs on an AI reply from
 * the mobile app (Bearer). Same write as the web server action; the
 * propertyId in the URL wins over the body so a client can't file feedback
 * under another property (RLS would refuse anyway).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = AiFeedbackInputSchema.safeParse({ ...(raw as object), propertyId });
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const result = await upsertAiFeedback(supabase, user.id, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
