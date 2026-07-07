import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runDocContextualEdit } from "@/lib/ai/doc-contextual";

/**
 * POST /api/properties/:propertyId/documents/:documentId/ai/contextual
 *
 * Backend for the Liveblocks Tiptap AI Toolkit's contextual prompt — the
 * inline "Ask AI" / suggestion-menu edits inside the document editor. The
 * client's `resolveContextualPrompt` posts `{ prompt, context, previous? }`
 * and expects back the unwrapped `{ type, text }` (NOT `{ reply }` like the
 * sibling conversational `/ai` route).
 *
 * Auth mirrors that sibling route: member of the property, and the doc must
 * belong to it (propertyId-spoofing defense).
 */

const Body = z.object({
  prompt: z.string().min(1),
  context: z.object({
    beforeSelection: z.string(),
    selection: z.string(),
    afterSelection: z.string(),
  }),
  // The client forwards Liveblocks' `previous.response` (a ContextualPrompt
  // response), so the shape here is `{ type, text }`.
  previous: z
    .object({
      type: z.enum(["insert", "replace", "other"]),
      text: z.string(),
    })
    .optional(),
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
    console.error("[doc-contextual] invalid json", err);
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const result = await runDocContextualEdit({
      prompt: parsed.data.prompt,
      context: parsed.data.context,
      previous: parsed.data.previous,
    });
    // Unwrapped { type, text } — exactly the shape resolveContextualPrompt
    // consumes. Do NOT wrap in { reply }.
    return NextResponse.json(result);
  } catch (err) {
    console.error("[doc-contextual] runDocContextualEdit failed", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
