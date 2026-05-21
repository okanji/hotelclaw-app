"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions that mutate calendar entries. These are called from the
 * event dialog + drag-to-schedule; realtime subscribers (other tabs, other
 * users) get the update via `meetings`/`tasks`/`meeting_attendees` postgres
 * changes, so we only invalidate the calling user's cache.
 */

type SaveMeetingInput = {
  propertyId: string;
  meetingId?: string;
  title: string;
  description?: string;
  location?: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  attendeeIds: string[];
  /** When true, the meeting is also a Stream Video call (default). */
  withVideoCall: boolean;
};

export async function saveMeeting(input: SaveMeetingInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  // For walk-up calls we'd set started_at = now(); a scheduled meeting
  // hasn't started until someone joins, so leave started_at null (DB
  // default) and let the active-meeting widget update it on join.
  //
  // stream_call_id is NOT NULL even for "no video" calendar entries — we
  // always generate one so the toggle only affects whether the join CTA
  // renders, not the row layout.
  const payload = {
    property_id: input.propertyId,
    title: input.title || "Untitled meeting",
    description: input.description ?? null,
    location: input.location ?? null,
    scheduled_start: input.start,
    scheduled_end: input.end,
    all_day: input.allDay,
    host_id: user.id,
    stream_call_id: `cal-${crypto.randomUUID()}`,
    stream_call_type: input.withVideoCall ? "default" : "calendar",
  };

  let meetingId = input.meetingId;
  if (meetingId) {
    const { error } = await supabase
      .from("meetings")
      .update({
        title: payload.title,
        description: payload.description,
        location: payload.location,
        scheduled_start: payload.scheduled_start,
        scheduled_end: payload.scheduled_end,
        all_day: payload.all_day,
        stream_call_type: payload.stream_call_type,
      })
      .eq("id", meetingId);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("meetings")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { error: error.message };
    meetingId = data.id;
  }

  // Sync the attendees: drop any not in the new list, upsert the rest. The
  // host is always implicitly an attendee with is_organizer=true so the
  // calendar shows on their own grid even if they didn't add themselves.
  const desiredIds = Array.from(new Set([user.id, ...input.attendeeIds]));
  const desiredRows = desiredIds.map((uid) => ({
    meeting_id: meetingId!,
    user_id: uid,
    is_organizer: uid === user.id,
  }));
  // Replace-all by deleting non-matching rows then upserting the desired
  // set. Two round-trips but the table is tiny per-meeting; saves dragging
  // in a server-side stored-procedure for one save path.
  const { error: delError } = await supabase
    .from("meeting_attendees")
    .delete()
    .eq("meeting_id", meetingId)
    .not("user_id", "in", `(${desiredIds.map((id) => `"${id}"`).join(",")})`);
  if (delError) return { error: delError.message };
  const { error: upError } = await supabase
    .from("meeting_attendees")
    .upsert(desiredRows, { onConflict: "meeting_id,user_id" });
  if (upError) return { error: upError.message };

  revalidatePath(`/p/${input.propertyId}/calendar`);
  return { ok: true as const, meetingId };
}

export async function deleteMeeting(propertyId: string, meetingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const { error } = await supabase
    .from("meetings")
    .delete()
    .eq("id", meetingId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/calendar`);
  return { ok: true as const };
}

/**
 * Schedule (or reschedule) a task into a calendar slot. The kanban Board
 * never sets scheduled_*; only the calendar drag-and-drop and the event
 * dialog do, so the boards stay clean of stale schedule data.
 */
export async function scheduleTask(input: {
  propertyId: string;
  taskId: string;
  start: string;
  end: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const { error } = await supabase
    .from("tasks")
    .update({
      scheduled_start: input.start,
      scheduled_end: input.end,
    })
    .eq("id", input.taskId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${input.propertyId}/calendar`);
  revalidatePath(`/p/${input.propertyId}/tasks`);
  return { ok: true as const };
}

export async function unscheduleTask(propertyId: string, taskId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const { error } = await supabase
    .from("tasks")
    .update({ scheduled_start: null, scheduled_end: null })
    .eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${propertyId}/calendar`);
  return { ok: true as const };
}
