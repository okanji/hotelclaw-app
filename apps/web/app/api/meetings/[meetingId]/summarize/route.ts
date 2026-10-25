import { NextResponse, after, type NextRequest } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { regenerateMeetingSummary } from "@/lib/meetings/summarize";

/**
 * POST /api/meetings/:meetingId/summarize — "Regenerate summary".
 *
 * Re-runs the summary from the transcript already mirrored in
 * `meeting_transcripts.raw_jsonl`. Member-gated (cookie or mobile Bearer).
 * The model call runs in `after()` like the webhook's background work, so
 * this answers 202 immediately; the new `meeting_summaries` row reaches the
 * page over that table's realtime publication.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { meetingId } = await params;

  // RLS returns the row only to members of its property.
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, property_id")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Defense in depth: the work below runs on the service client, so re-check
  // membership explicitly rather than trusting RLS alone.
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", meeting.property_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: transcript } = await supabase
    .from("meeting_transcripts")
    .select("id")
    .eq("meeting_id", meetingId)
    .not("raw_jsonl", "is", null)
    .limit(1)
    .maybeSingle();
  if (!transcript) {
    return NextResponse.json(
      { error: "no stored transcript to summarize" },
      { status: 409 },
    );
  }

  after(async () => {
    try {
      await regenerateMeetingSummary(meetingId);
    } catch (e) {
      console.error("regenerateMeetingSummary failed", meetingId, e);
    }
  });

  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}
