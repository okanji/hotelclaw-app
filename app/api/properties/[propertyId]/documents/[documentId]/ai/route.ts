import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runDocBot } from "@/lib/ai/bots/doc-bot";

/**
 * POST /api/properties/:propertyId/documents/:documentId/ai
 *
 * Document-bot turn. Caller posts the conversation so far; the bot
 * generates the next assistant turn and we return its text.
 *
 * No persistence: the client owns the conversation array and sends it
 * each turn. Engaged-mode-style Redis persistence isn't needed here —
 * doc conversations are short and per-session.
 *
 * Auth: caller must be a member of the property. RLS catches it at the
 * data layer too, but the explicit check gives a clean 403 instead of
 * a confusing tool error.
 */

const TurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const Body = z.object({
  messages: z.array(TurnSchema).min(1),
  /** Live editor HTML — lets the bot reproduce unchanged blocks for clean diffs. */
  documentHtml: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; documentId: string }> },
) {
  const { propertyId, documentId } = await params;
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

  // Verify the doc belongs to this property — same propertyId-spoofing
  // defense as the task route.
  const { data: doc } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!doc) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    console.error("[doc-bot] invalid json", err);
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const result = await runDocBot({
      propertyId,
      userId: user.id,
      documentId,
      messages: parsed.data.messages,
      documentHtml: parsed.data.documentHtml,
    });
    // `edit` is non-null when the bot drafted content to write into the doc —
    // the client renders it with an "Insert into document" action.
    return NextResponse.json({ reply: result.text, edit: result.edit });
  } catch (err) {
    console.error("[doc-bot] runDocBot failed", err);
    return NextResponse.json(
      { error: "generation failed" },
      { status: 500 },
    );
  }
}
