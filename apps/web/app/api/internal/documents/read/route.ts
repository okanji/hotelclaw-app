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
  const result = await readDocumentBodyHtml({ propertyId, documentId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
