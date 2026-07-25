import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { writeDocumentBody } from "@/lib/documents/write-body";

/**
 * INTERNAL document write endpoint — the eve runtime's path into document
 * content (which lives in Liveblocks Yjs and therefore can't be written by
 * a direct Supabase insert; see lib/documents/write-body.ts).
 *
 * Auth: exact service-role bearer, same trust model as the eve channel's
 * service path. /api/* bypasses proxy middleware; this check is the gate.
 * Tenancy: propertyId is re-verified against the document row inside
 * writeDocumentBody — the caller can never cross properties.
 */

export const maxDuration = 60;

const Body = z.object({
  propertyId: z.string().uuid(),
  // Update path: documentId present. Create path: title present.
  documentId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  parentId: z.string().uuid().nullish(),
  html: z.string().min(1).max(120_000).optional(),
  mode: z.enum(["replace", "append"]).default("replace"),
  /** Real requester (chat sender) — recorded as the doc creator. */
  actorUserId: z.string().uuid().optional(),
  /**
   * Create the empty document row and return its id WITHOUT writing a body.
   *
   * Lets `create_document` post its artifact card with a real document_id
   * before the content write starts, so the chat panel can open on the live
   * room and the viewer watches the doc being written. Without this the id
   * only exists once the write has finished — there is nothing left to
   * watch. Requires `title`; ignores `html`.
   */
  reserveOnly: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  let documentId = input.documentId ?? null;
  if (!documentId) {
    if (!input.title) {
      return NextResponse.json(
        { error: "title is required to create a document" },
        { status: 400 },
      );
    }
    const supabase = createServiceClient();
    // Mirrors components/documents/actions.ts createDocument: append at the
    // end of the sibling list; body/Yjs room is created by the write below.
    let positionQuery = supabase
      .from("documents")
      .select("position")
      .eq("property_id", input.propertyId);
    positionQuery = input.parentId
      ? positionQuery.eq("parent_id", input.parentId)
      : positionQuery.is("parent_id", null);
    const { data: last } = await positionQuery
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: created, error } = await supabase
      .from("documents")
      .insert({
        property_id: input.propertyId,
        title: input.title,
        parent_id: input.parentId ?? null,
        position: (last?.position ?? 0) + 1024,
        kind: "doc",
        source: "ai",
        ...(input.actorUserId ? { created_by: input.actorUserId } : {}),
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    documentId = created.id;
  }

  if (input.reserveOnly) {
    return NextResponse.json({
      ok: true,
      documentId,
      title: input.title ?? null,
      bodyTextLength: 0,
      url: `/p/${input.propertyId}/documents/${documentId}`,
    });
  }

  if (!input.html) {
    return NextResponse.json(
      { error: "html is required unless reserveOnly is set" },
      { status: 400 },
    );
  }

  const result = await writeDocumentBody({
    propertyId: input.propertyId,
    documentId,
    html: input.html,
    mode: input.mode,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  let title = input.title ?? null;
  if (!title) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("documents")
      .select("title")
      .eq("id", documentId)
      .maybeSingle();
    title = data?.title ?? null;
  }
  return NextResponse.json({
    ok: true,
    documentId,
    title,
    bodyTextLength: result.bodyTextLength,
    url: `/p/${input.propertyId}/documents/${documentId}`,
  });
}
