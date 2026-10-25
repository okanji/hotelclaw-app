import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getTriagePendingCount } from "@/lib/tasks/triage-queue";

/** `GET /api/properties/:propertyId/triage/count[?spaceId=]` → `{ count }`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const spaceId = new URL(request.url).searchParams.get("spaceId");
  try {
    const count = await getTriagePendingCount(supabase, propertyId, { spaceId });
    return NextResponse.json({ count });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to count triage" },
      { status: 500 },
    );
  }
}
