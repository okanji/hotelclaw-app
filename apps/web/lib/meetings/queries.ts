import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { MeetingRecurrence } from "@/lib/db/types";
import type { MeetingStatusInput } from "@/lib/meetings/status";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type MeetingListItem = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  host_id: string | null;
  host_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  duration_seconds: number | null;
  has_summary: boolean;
  speakers: Array<{ id: string; name: string }>;
  /** Lifecycle inputs for `lib/meetings/status.ts`. */
  created_at: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  stream_call_id: string;
  stream_call_type: string;
  recurrence: MeetingRecurrence | null;
  transcript: MeetingStatusInput["transcript"];
  attendee_count: number;
};

/**
 * Meetings for the property, newest first.
 *
 * The FK on `meetings.host_id` points at `auth.users`, not `public.profiles`,
 * so PostgREST can't auto-join profiles via a relational hint. Same story
 * for the channel join when the schema cache is stale right after a fresh
 * migration. We avoid both by issuing three plain selects and stitching the
 * lookups in JS — cheap (one row per fk, indexed) and immune to PostgREST's
 * schema-cache timing.
 */
export async function getMeetings(
  supabase: ServerClient,
  propertyId: string,
  limit = 100,
): Promise<MeetingListItem[]> {
  // supabase-js can't infer embedded selects without `Relationships` on the
  // Database type (we declare those empty for the new meeting tables), so
  // we cast through `unknown` to the actual runtime shape after fetching.
  type MeetingRow = {
    id: string;
    title: string;
    started_at: string | null;
    ended_at: string | null;
    host_id: string | null;
    channel_id: string | null;
    created_at: string;
    scheduled_start: string | null;
    scheduled_end: string | null;
    stream_call_id: string;
    stream_call_type: string;
    recurrence: MeetingRecurrence | null;
    meeting_transcripts: Array<{
      id: string;
      duration_seconds: number | null;
      speakers: Array<{ id: string; name: string }>;
      status: string;
      created_at: string;
    }>;
    meeting_summaries: Array<{ id: string; created_at: string }>;
    meeting_attendees: Array<{ user_id: string }>;
  };

  const { data: rawMeetings, error } = await supabase
    .from("meetings")
    .select(
      "id, title, started_at, ended_at, host_id, channel_id, created_at, scheduled_start, scheduled_end, stream_call_id, stream_call_type, recurrence, meeting_transcripts(id, duration_seconds, speakers, status, created_at), meeting_summaries(id, created_at), meeting_attendees(user_id)",
    )
    .eq("property_id", propertyId)
    // Newest rows first so the limit keeps recent + upcoming work; the page
    // re-groups by lifecycle (lib/meetings/status.ts) anyway.
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getMeetings failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return [];
  }

  const meetings = (rawMeetings ?? []) as unknown as MeetingRow[];
  if (meetings.length === 0) return [];

  const hostIds = uniqIds(meetings.map((m) => m.host_id));
  const channelIds = uniqIds(meetings.map((m) => m.channel_id));

  const [{ data: hosts }, { data: channels }] = await Promise.all([
    hostIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", hostIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    channelIds.length
      ? supabase.from("chat_channels").select("id, name").in("id", channelIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const hostName = new Map((hosts ?? []).map((p) => [p.id, p.full_name]));
  const channelName = new Map((channels ?? []).map((c) => [c.id, c.name]));

  return meetings.map((m) => {
    const latestTranscript = [...(m.meeting_transcripts ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )[0];
    return {
      id: m.id,
      title: m.title,
      started_at: m.started_at ?? new Date(0).toISOString(),
      ended_at: m.ended_at,
      host_id: m.host_id,
      host_name: m.host_id ? hostName.get(m.host_id) ?? null : null,
      channel_id: m.channel_id,
      channel_name: m.channel_id ? channelName.get(m.channel_id) ?? null : null,
      duration_seconds: latestTranscript?.duration_seconds ?? null,
      has_summary: (m.meeting_summaries ?? []).length > 0,
      speakers: latestTranscript?.speakers ?? [],
      created_at: m.created_at,
      scheduled_start: m.scheduled_start,
      scheduled_end: m.scheduled_end,
      stream_call_id: m.stream_call_id,
      stream_call_type: m.stream_call_type,
      recurrence: m.recurrence,
      transcript: latestTranscript
        ? { status: latestTranscript.status, created_at: latestTranscript.created_at }
        : null,
      attendee_count: (m.meeting_attendees ?? []).length,
    };
  });
}

export type MeetingDetail = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  host_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  /** Lifecycle inputs for `lib/meetings/status.ts`. */
  created_at: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  stream_call_id: string;
  stream_call_type: string;
  recurrence: MeetingRecurrence | null;
  transcript: {
    id: string;
    status: string;
    raw_jsonl: string | null;
    speakers: Array<{ id: string; name: string }>;
    duration_seconds: number | null;
    created_at: string;
  } | null;
  summary: {
    id: string;
    summary_md: string;
    action_items: Array<{ text: string; owner: string | null }>;
    decisions: string[];
    model: string;
    created_at: string;
    document_id: string | null;
  } | null;
};

export async function getMeetingDetail(
  supabase: ServerClient,
  meetingId: string,
): Promise<MeetingDetail | null> {
  type MeetingDetailRow = {
    id: string;
    title: string;
    started_at: string | null;
    ended_at: string | null;
    host_id: string | null;
    channel_id: string | null;
    created_at: string;
    scheduled_start: string | null;
    scheduled_end: string | null;
    stream_call_id: string;
    stream_call_type: string;
    recurrence: MeetingRecurrence | null;
    meeting_transcripts: Array<{
      id: string;
      status: string;
      raw_jsonl: string | null;
      speakers: Array<{ id: string; name: string }>;
      duration_seconds: number | null;
      created_at: string;
    }>;
    meeting_summaries: Array<{
      id: string;
      summary_md: string;
      action_items: Array<{ text: string; owner: string | null }>;
      decisions: string[];
      model: string;
      created_at: string;
      document_id: string | null;
    }>;
  };

  const { data: rawMeeting, error } = await supabase
    .from("meetings")
    .select(
      "id, title, started_at, ended_at, host_id, channel_id, created_at, scheduled_start, scheduled_end, stream_call_id, stream_call_type, recurrence, meeting_transcripts(id, status, raw_jsonl, speakers, duration_seconds, created_at), meeting_summaries(id, summary_md, action_items, decisions, model, created_at, document_id)",
    )
    .eq("id", meetingId)
    .maybeSingle();

  if (error) {
    console.error("getMeetingDetail failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return null;
  }
  if (!rawMeeting) return null;
  const meeting = rawMeeting as unknown as MeetingDetailRow;

  const [hostRow, channelRow] = await Promise.all([
    meeting.host_id
      ? supabase
          .from("profiles")
          .select("full_name")
          .eq("id", meeting.host_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { full_name: string | null } | null }),
    meeting.channel_id
      ? supabase
          .from("chat_channels")
          .select("name")
          .eq("id", meeting.channel_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);

  // Embedded arrays carry no order guarantee — latest by created_at wins.
  const latest = <T extends { created_at: string }>(rows: T[] | null) =>
    [...(rows ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null;
  const transcript = latest(meeting.meeting_transcripts);
  const summary = latest(meeting.meeting_summaries);

  return {
    id: meeting.id,
    title: meeting.title,
    started_at: meeting.started_at ?? new Date(0).toISOString(),
    ended_at: meeting.ended_at,
    host_name: hostRow.data?.full_name ?? null,
    channel_id: meeting.channel_id,
    channel_name: channelRow.data?.name ?? null,
    created_at: meeting.created_at,
    scheduled_start: meeting.scheduled_start,
    scheduled_end: meeting.scheduled_end,
    stream_call_id: meeting.stream_call_id,
    stream_call_type: meeting.stream_call_type,
    recurrence: meeting.recurrence,
    transcript: transcript
      ? {
          id: transcript.id,
          status: transcript.status,
          raw_jsonl: transcript.raw_jsonl ?? null,
          speakers: transcript.speakers ?? [],
          duration_seconds: transcript.duration_seconds ?? null,
          created_at: transcript.created_at,
        }
      : null,
    summary: summary
      ? {
          id: summary.id,
          summary_md: summary.summary_md,
          action_items: summary.action_items ?? [],
          decisions: summary.decisions ?? [],
          model: summary.model,
          created_at: summary.created_at,
          document_id: summary.document_id ?? null,
        }
      : null,
  };
}

function uniqIds(ids: Array<string | null>): string[] {
  const set = new Set<string>();
  for (const id of ids) {
    if (id) set.add(id);
  }
  return [...set];
}
