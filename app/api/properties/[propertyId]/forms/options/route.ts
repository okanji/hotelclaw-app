import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { FORM_SOURCE_KINDS, type FormSourceKind } from "@/lib/forms/schema";
import {
  resolveSheetColumns,
  resolveSourceOptions,
} from "@/lib/forms/resolve-options";

// GET /api/properties/:propertyId/forms/options — live options for
// data-connected choice fields, plus the builder's sheet/column pickers.
//
//   ?kind=members|projects|tasks|spaces|labels      → { options }
//   ?kind=sheet_column                              → { sheets }  (sheet picker)
//   ?kind=sheet_column&documentId=X                 → { columns } (column picker)
//   ?kind=sheet_column&documentId=X&column=Y        → { options }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const searchParams = request.nextUrl.searchParams;
  const kind = searchParams.get("kind");
  if (!kind || !(FORM_SOURCE_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  const documentId = searchParams.get("documentId")?.trim() || undefined;
  const column = searchParams.get("column")?.trim() || undefined;

  const supabase = await createClient();

  if (kind === "sheet_column" && !documentId) {
    // Sheet picker: this property's sheet documents.
    const { data, error } = await supabase
      .from("documents")
      .select("id, title")
      .eq("property_id", propertyId)
      .eq("kind", "sheet")
      .is("archived_at", null)
      .order("title");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      sheets: (data ?? []).map((d) => ({ id: d.id, label: d.title })),
    });
  }

  if (kind === "sheet_column" && documentId && !column) {
    // Column picker: header-row labels for the first sheet's columns.
    const columns = await resolveSheetColumns(supabase, propertyId, documentId);
    return NextResponse.json({ columns });
  }

  const options = await resolveSourceOptions(supabase, propertyId, {
    kind: kind as FormSourceKind,
    documentId,
    column,
  });
  return NextResponse.json({ options });
}
