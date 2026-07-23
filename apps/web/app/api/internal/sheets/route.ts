import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import { captureSheetSnapshot } from "@/lib/spreadsheet/snapshot";
import { writeSheetCells } from "@/lib/spreadsheet/write-cells";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * INTERNAL spreadsheet endpoints for the eve runtime (service-bearer auth,
 * same trust model as /api/internal/documents/*):
 *   GET  ?propertyId&documentId → live workbook snapshot (sheets, cells in
 *        A1-addressable grids) for reading/answering.
 *   POST { propertyId, documentId, sheetTitle?, cells: [{ref, value}] } →
 *        live cell writes via Liveblocks mutateStorage + snapshot refresh.
 */

export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!propertyId || !documentId) {
    return NextResponse.json({ error: "propertyId and documentId required" }, { status: 400 });
  }
  const supabase = createServiceClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, kind")
    .eq("id", documentId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!doc || doc.kind !== "sheet") {
    return NextResponse.json({ error: "Spreadsheet not found in this property." }, { status: 404 });
  }
  const liveblocks = getLiveblocksServer();
  const snapshot = await captureSheetSnapshot(
    liveblocks,
    roomIdForDocument(propertyId, documentId),
  ).catch(() => null);
  if (!snapshot) {
    return NextResponse.json({ error: "Sheet storage unavailable." }, { status: 422 });
  }
  return NextResponse.json({ ok: true, title: doc.title, workbook: snapshot });
}

const WriteBody = z.object({
  propertyId: z.string().uuid(),
  documentId: z.string().uuid(),
  sheetTitle: z.string().max(120).nullish(),
  cells: z
    .array(z.object({ ref: z.string().min(2).max(8), value: z.string().max(2000) }))
    .min(1)
    .max(200),
});

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = WriteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const result = await writeSheetCells(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json(result);
}
