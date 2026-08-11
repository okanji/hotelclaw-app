"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
// Meeting writes live in lib/calendar/mutations so the REST routes (mobile,
// Bearer auth) and these actions (web, cookie auth) can't diverge.
import {
  deleteMeetingFor,
  saveMeetingFor,
  type SaveMeetingInput,
} from "@/lib/calendar/mutations";

/**
 * Server actions that mutate calendar entries. These are called from the
 * event dialog + drag-to-schedule; realtime subscribers (other tabs, other
 * users) get the update via `meetings`/`tasks`/`meeting_attendees` postgres
 * changes, so we only invalidate the calling user's cache.
 */

export async function saveMeeting(input: SaveMeetingInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const result = await saveMeetingFor(supabase, user.id, input);
  if ("error" in result) return result;

  revalidatePath(`/p/${input.propertyId}/calendar`);
  return { ok: true as const, meetingId: result.meetingId };
}

export async function deleteMeeting(propertyId: string, meetingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const result = await deleteMeetingFor(supabase, meetingId);
  if ("error" in result) return result;
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

/**
 * RSVP to a meeting — updates the caller's own attendee row. The update is
 * keyed on (meeting_id, user_id = auth user) so an attendee can never set
 * someone else's response; zero matched rows means the caller isn't on the
 * guest list.
 */
export async function respondToMeeting(input: {
  propertyId: string;
  meetingId: string;
  response: "accepted" | "declined" | "tentative";
}) {
  if (!["accepted", "declined", "tentative"].includes(input.response)) {
    return { error: "invalid response" as const };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const { data, error } = await supabase
    .from("meeting_attendees")
    .update({ response: input.response })
    .eq("meeting_id", input.meetingId)
    .eq("user_id", user.id)
    .select("user_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "you are not on this meeting's guest list" as const };
  }
  revalidatePath(`/p/${input.propertyId}/calendar`);
  return { ok: true as const };
}
