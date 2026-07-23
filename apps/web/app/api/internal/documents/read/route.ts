import { NextResponse, type NextRequest } from "next/server";
import { readDocumentBodyHtml } from "@/lib/documents/write-body";

/**
 * INTERNAL document read endpoint — the eve runtime's faithful-HTML read
 * (body_json → HTML with the same extension set the writer uses), so the
 * AI can quote full contents and make surgical edits that preserve
 * structure. Auth: exact service-role bearer (same trust model as the
 * write endpoint; /api/* bypasses proxy middleware).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!propertyId || !documentId) {
    return NextResponse.json(
      { error: "propertyId and documentId required" },
      { status: 400 },
    );
  }

  // ?revisions=1 → list the pre-replace revision stash (newest first).
  if (request.nextUrl.searchParams.get("revisions") === "1") {
    const { createServiceClient } = await import("@/lib/supabase/server");
    const { data } = await createServiceClient()
      .from("document_ai_revisions")
      .select("id, replaced_at, note, body_text")
      .eq("document_id", documentId)
      .eq("property_id", propertyId)
      .order("replaced_at", { ascending: false })
      .limit(10);
    return NextResponse.json({
      ok: true,
      revisions: (data ?? []).map((r) => ({
        id: r.id,
        replaced_at: r.replaced_at,
        note: r.note,
        preview: (r.body_text ?? "").slice(0, 160),
        characters: (r.body_text ?? "").length,
      })),
    });
  }

  const result = await readDocumentBodyHtml({
    propertyId,
    documentId,
    revisionId: request.nextUrl.searchParams.get("revisionId"),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
