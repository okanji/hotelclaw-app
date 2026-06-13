"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { MeetingRecurrence } from "@/lib/db/types";

/**
 * Server actions that mutate calendar entries. These are called from the
 * event dialog + drag-to-schedule; realtime subscribers (other tabs, other
 * users) get the update via `meetings`/`tasks`/`meeting_attendees` postgres
 * changes, so we only invalidate the calling user's cache.
 */

const RecurrenceSchema: z.ZodType<MeetingRecurrence | null> = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().positive().optional(),
    until: z.string().optional(),
    count: z.number().int().positive().optional(),
    byweekday: z.array(z.string()).optional(),
  })
  .passthrough()
  .nullable() as unknown as z.ZodType<MeetingRecurrence | null>;

const SaveMeetingSchema = z
  .object({
    propertyId: z.string().uuid(),
    meetingId: z.string().uuid().optional(),
    title: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.string().datetime(),
    end: z.string().datetime(),
    allDay: z.boolean(),
    attendeeIds: z.array(z.string().uuid()),
    withVideoCall: z.boolean(),
    recurrence: RecurrenceSchema,
  })
  .refine((v) => new Date(v.end).getTime() >= new Date(v.start).getTime(), {
    message: "end must be after start",
    path: ["end"],
  });

type SaveMeetingInput = z.infer<typeof SaveMeetingSchema>;

export async function saveMeeting(input: SaveMeetingInput) {
  const parsed = SaveMeetingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "invalid input" };
  }
  input = parsed.data;
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
    recurrence: input.recurrence,
  };

  // The organizer is fixed at creation (= meetings.host_id) and survives
  // edits by other members. Resolve it BEFORE syncing attendees so an
  // editor never inherits the role — previously `is_organizer` was derived
  // from whoever saved, which let any edit quietly steal organizer-ship
  // and could even drop the real host from their own guest list.
  let organizerId = user.id;

  let meetingId = input.meetingId;
  if (meetingId) {
    const { data: existing, error: existingError } = await supabase
      .from("meetings")
      .select("host_id")
      .eq("id", meetingId)
      .single();
    if (existingError) return { error: existingError.message };
    organizerId = existing.host_id ?? user.id;
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
        recurrence: payload.recurrence,
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
  // organizer is always implicitly an attendee (so the meeting shows on
  // their own grid even if they didn't add themselves) and can never be
  // removed. An editor who isn't the organizer is NOT auto-added — editing
  // a meeting is not the same as joining it. The upsert also re-derives
  // is_organizer from the true organizer, which self-heals rows corrupted
  // by the old editor-steals-organizer behaviour.
  const desiredIds = Array.from(new Set([organizerId, ...input.attendeeIds]));
  const desiredRows = desiredIds.map((uid) => ({
    meeting_id: meetingId!,
    user_id: uid,
    is_organizer: uid === organizerId,
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
