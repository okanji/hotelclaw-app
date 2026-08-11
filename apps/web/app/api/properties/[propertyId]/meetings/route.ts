import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { saveMeetingFor } from "@/lib/calendar/mutations";

/**
 * `POST /api/properties/:propertyId/meetings` — create a calendar event.
 *
 * Exists for mobile, which cannot call the `saveMeeting` server action. Runs
 * the SAME `saveMeetingFor`, so organizer resolution and attendee syncing match
 * web exactly. The propertyId comes from the route, never the body.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const result = await saveMeetingFor(supabase, user.id, {
    allDay: false,
    attendeeIds: [],
    withVideoCall: false,
    recurrence: null,
    ...body,
    propertyId,
    // A create must never carry a meetingId — that would be an edit smuggled
    // through the create route, bypassing the ownership check on PATCH.
    meetingId: undefined,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ meetingId: result.meetingId }, { status: 201 });
}
