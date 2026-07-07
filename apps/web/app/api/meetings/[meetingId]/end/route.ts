import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * Mark a meeting as ended. Client-side leave already disconnects the user
 * from Stream; this just stamps the row so the meetings list shows the
 * correct status and the upcoming transcription_ready webhook has an
 * anchor to compute duration off.
 *
 * Idempotent — subsequent calls are no-ops (we don't overwrite ended_at
 * once it's set).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { meetingId } = await params;

  // Membership check via the user-scoped client — RLS guarantees this row
  // is only returned when the caller is a member of the property.
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, ended_at, property_id")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Defense in depth: RLS already filtered the read, but the service-client
  // update below bypasses RLS. Re-verify membership against the property id
  // we just read so a future RLS regression can't escalate.
  const membership = await getMembershipForProperty(meeting.property_id);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (meeting.ended_at) {
    return NextResponse.json({ ok: true, alreadyEnded: true });
  }

  const service = createServiceClient();
  const { error } = await service
    .from("meetings")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", meetingId)
    .is("ended_at", null);

  if (error) {
    console.error("meetings end update failed", error);
    return NextResponse.json({ error: "could not end" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
