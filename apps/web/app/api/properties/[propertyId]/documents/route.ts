import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getDocuments } from "@/lib/documents/queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getDocuments(supabase, propertyId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load documents" },
      { status: 500 },
    );
  }
}
