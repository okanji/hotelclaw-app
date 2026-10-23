import { NextResponse, type NextRequest } from "next/server";
import { MEMORY_SUBJECT_KINDS, type MemorySubjectKind } from "@hotelclaw/memory";
import { getMembershipForProperty } from "@/lib/auth/session";
import { memoryStore } from "@/lib/memory/store";

/**
 * Memory browser reads. Membership is the gate (the same RLS predicate the
 * table carries); the listing itself goes through the shared store so the
 * browser shows exactly what the bots recall.
 *
 *   GET ?kind=property|user|guest&q=<text>&limit=<n>
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const subjectKind = (MEMORY_SUBJECT_KINDS as readonly string[]).includes(kindParam ?? "")
    ? (kindParam as MemorySubjectKind)
    : undefined;
  const query = url.searchParams.get("q")?.slice(0, 200) ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 300);

  const store = memoryStore();
  const [rows, counts] = await Promise.all([
    store.listProperty(propertyId, { subjectKind, query, limit }),
    store.counts(propertyId),
  ]);
  return NextResponse.json({ memories: rows, counts });
}
