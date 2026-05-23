import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocuments } from "@/lib/documents/queries";

export async function GET(
  _request: Request,
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

  try {
    const docs = await getDocuments(supabase, propertyId);
    // TEMP debug for "All documents disappears" — remove once root cause found.
    console.log(
      "[docs-api]",
      propertyId,
      "user=",
      user.id.slice(0, 6),
      "rows=",
      docs.length,
      "first=",
      docs[0]?.id?.slice(0, 6) ?? "—",
    );
    return NextResponse.json(docs);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load documents" },
      { status: 500 },
    );
  }
}
