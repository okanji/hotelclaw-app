import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MeetingRecurrence } from "@/lib/db/types";

type Db = SupabaseClient<Database>;

/**
 * Calendar writes, decoupled from how the caller authenticated.
 *
 * `lib/calendar/actions.ts` (web, cookie session) and the REST routes under
 * `/api/properties/:id/meetings` (mobile, Bearer) both call these, so the two
 * clients can't drift on organizer handling or attendee syncing — the parts
 * that have already been the source of one bug (an editor silently stealing
 * organizer-ship).
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

export const SaveMeetingSchema = z
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

export type SaveMeetingInput = z.infer<typeof SaveMeetingSchema>;

export async function saveMeetingFor(
  supabase: Db,
  userId: string,
  // `unknown` on purpose: the REST routes hand over a parsed JSON body, and the
  // schema below is the single validation gate for every caller.
  rawInput: unknown,
): Promise<{ ok: true; meetingId: string } | { error: string }> {
  const parsed = SaveMeetingSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "invalid input" };
  }
  const input = parsed.data;

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
    host_id: userId,
    stream_call_id: `cal-${crypto.randomUUID()}`,
    stream_call_type: input.withVideoCall ? "default" : "calendar",
    recurrence: input.recurrence,
  };

  // The organizer is fixed at creation (= meetings.host_id) and survives
  // edits by other members. Resolve it BEFORE syncing attendees so an
  // editor never inherits the role.
  let organizerId = userId;

  let meetingId = input.meetingId;
  if (meetingId) {
    const { data: existing, error: existingError } = await supabase
      .from("meetings")
      .select("host_id")
      .eq("id", meetingId)
      .single();
    if (existingError) return { error: existingError.message };
    organizerId = existing.host_id ?? userId;
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
  // organizer is always implicitly an attendee and can never be removed.
  const desiredIds = Array.from(new Set([organizerId, ...input.attendeeIds]));
  const desiredRows = desiredIds.map((uid) => ({
    meeting_id: meetingId!,
    user_id: uid,
    is_organizer: uid === organizerId,
  }));
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

  return { ok: true, meetingId };
}

export async function deleteMeetingFor(
  supabase: Db,
  meetingId: string,
): Promise<{ ok: true } | { error: string }> {
  // `select()` so we can count what was actually removed. An RLS-denied delete
  // is NOT an error in Postgres — it affects zero rows and returns success,
  // which is exactly how the missing delete policy (fixed in migration 0097)
  // stayed invisible: the UI reported "deleted" while the row survived. Treat
  // zero rows as the failure it is.
  const { data, error } = await supabase
    .from("meetings")
    .delete()
    .eq("id", meetingId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Not allowed to delete this event." };
  }
  return { ok: true };
}
