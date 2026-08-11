import { NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { deleteMeetingFor, saveMeetingFor } from "@/lib/calendar/mutations";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * RLS scopes meetings to the property's members, but the route's propertyId
 * must also agree with the row's — otherwise a member of property A could
 * address a meeting id from property B and get a confusing error instead of a
 * 404.
 */
async function assertInProperty(
  supabase: SupabaseClient<Database>,
  meetingId: string,
  propertyId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .eq("property_id", propertyId)
    .maybeSingle();
  return !!data;
}

/** `GET` — one event, for the mobile detail sheet. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; meetingId: string }> },
) {
  const { propertyId, meetingId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("meetings")
    .select(
      "id, title, description, location, scheduled_start, scheduled_end, all_day, host_id, recurrence, stream_call_type",
    )
    .eq("id", meetingId)
    .eq("property_id", propertyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: attendees } = await supabase
    .from("meeting_attendees")
    .select("user_id, is_organizer, response")
    .eq("meeting_id", meetingId);

  return NextResponse.json({ ...data, attendees: attendees ?? [] });
}

/** `PATCH` — edit an event. Same `saveMeetingFor` the web dialog uses. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; meetingId: string }> },
) {
  const { propertyId, meetingId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await assertInProperty(supabase, meetingId, propertyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
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
    meetingId,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, meetingId: result.meetingId });
}

/** `DELETE` — cancel an event. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; meetingId: string }> },
) {
  const { propertyId, meetingId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await assertInProperty(supabase, meetingId, propertyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await deleteMeetingFor(supabase, meetingId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
