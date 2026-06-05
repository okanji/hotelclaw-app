import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarRange,
  CalendarSource,
  ConnectionRow,
  ExternalEvent,
  MeetingEvent,
  TaskEvent,
} from "./types";
import { expandRecurrence } from "./recurrence";
import type { MeetingRecurrence } from "@/lib/db/types";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Fetch every "event" the calendar grid renders for a property + user, in
 * one call. The three sources (meetings, tasks-with-schedule, external
 * provider events) share a unified `CalendarEvent` shape so the renderer
 * doesn't need to know where each row originated.
 *
 * Range filtering is half-open `[from, to)`. The query uses overlap, not
 * containment, so a 3-day meeting partially inside the window still appears.
 *
 * Calendar source filtering (the show/hide checkboxes in the sidebar) is
 * applied client-side off the same query — re-running the SQL on every
 * toggle would burn round-trips for what's effectively a CSS visibility
 * change. The grid query stays property-wide and dense; checkboxes hide.
 */
export async function getCalendarEvents(
  supabase: ServerClient,
  propertyId: string,
  userId: string,
  range: CalendarRange,
): Promise<CalendarEvent[]> {
  const { from, to } = range;

  // Meetings + attendees. Two cohorts:
  //   * One-off + walk-up: only need rows that overlap [from, to).
  //   * Recurring: the seed row may be far before the window; we need
  //     every recurring meeting where `scheduled_start < to` because an
  //     occurrence inside the window is a function of the rule, not of
  //     the seed's stored end time. We filter properly after expansion.
  // NOTE: we deliberately do NOT embed `profiles` under `meeting_attendees`
  // here. The schema's FK on `meeting_attendees.user_id` points at
  // `auth.users`, not `public.profiles`, so PostgREST can't resolve a
  // `profile:profiles(...)` path and 500s the whole request (PGRST200) —
  // even when there are zero meetings. Attendee profiles are merged in a
  // second `.in("id", …)` query below, mirroring the members route.
  const meetingsP = supabase
    .from("meetings")
    .select(
      `id, title, description, location, color, all_day,
       scheduled_start, scheduled_end, started_at, ended_at,
       host_id, channel_id, stream_call_id, recurrence,
       attendees:meeting_attendees(user_id, response, is_organizer)`,
    )
    .eq("property_id", propertyId)
    .or(
      `and(scheduled_start.lt.${to},scheduled_end.gt.${from}),` +
        `and(scheduled_start.is.null,started_at.lt.${to},or(ended_at.is.null,ended_at.gt.${from}))` +
        `,recurrence.not.is.null`,
    );

  // Tasks: any task with a scheduled window that overlaps. due_at-only
  // tasks aren't rendered as time-blocks (no duration), but they DO appear
  // as small markers via the separate "due-on-this-day" list — handled
  // client-side from the existing tasks query, so this endpoint only needs
  // scheduled blocks.
  const tasksP = supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, assignee_id, due_at, scheduled_start, scheduled_end",
    )
    .eq("property_id", propertyId)
    .not("scheduled_start", "is", null)
    .not("scheduled_end", "is", null)
    .lt("scheduled_start", to)
    .gt("scheduled_end", from);

  // External events live under the *user's* connections. Two-level RLS does
  // the scoping but we still need the IDs to apply the [from, to) filter.
  const externalP = supabase
    .from("external_events")
    .select(
      `id, title, description, location, start_at, end_at, all_day,
       busy_status, html_link, organizer_email, external_id,
       calendar:external_calendars!inner(id, color, selected,
         connection:calendar_connections!inner(provider, user_id))`,
    )
    .lt("start_at", to)
    .gt("end_at", from)
    .eq("calendar.connection.user_id", userId);

  const [meetings, tasks, external] = await Promise.all([
    meetingsP,
    tasksP,
    externalP,
  ]);

  if (meetings.error) throw new Error(meetings.error.message);
  if (tasks.error) throw new Error(tasks.error.message);
  if (external.error) throw new Error(external.error.message);

  // Merge attendee profiles in-memory (see the meetings-query note above).
  const attendeeIds = new Set<string>();
  for (const m of meetings.data ?? []) {
    const rows = (m.attendees ?? []) as unknown as Array<{ user_id: string }>;
    for (const a of rows) attendeeIds.add(a.user_id);
  }
  const profilesById = new Map<
    string,
    { full_name: string | null; avatar_url: string | null }
  >();
  if (attendeeIds.size > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", [...attendeeIds]);
    if (profilesError) throw new Error(profilesError.message);
    for (const p of profiles ?? []) {
      profilesById.set(p.id, {
        full_name: p.full_name,
        avatar_url: p.avatar_url,
      });
    }
  }

  const windowFrom = new Date(from);
  const windowTo = new Date(to);
  const meetingEvents: MeetingEvent[] = (meetings.data ?? []).flatMap((m) => {
    const start = m.scheduled_start ?? m.started_at;
    const end =
      m.scheduled_end ??
      m.ended_at ??
      // 30-min default render window for an in-progress walk-up call.
      new Date(new Date(start as string).getTime() + 30 * 60_000).toISOString();
    // Cast via unknown — supabase-js typegen doesn't model FK joins for our
    // hand-written Database types, so the inferred shape comes back as a
    // SelectQueryError. The runtime payload matches the cast. Profiles are
    // merged from `profilesById` (built above) rather than embedded.
    const rawAttendees = (m.attendees ?? []) as unknown as Array<{
      user_id: string;
      response: CalendarAttendee["response"];
      is_organizer: boolean;
    }>;
    const attendees: CalendarAttendee[] = rawAttendees.map((a) => {
      const profile = profilesById.get(a.user_id);
      return {
        user_id: a.user_id,
        name: profile?.full_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
        response: a.response,
        is_organizer: a.is_organizer,
      };
    });
    const baseMeeting = {
      source: "meeting" as const,
      id: m.id,
      title: m.title ?? "Meeting",
      description: m.description,
      location: m.location,
      color: m.color,
      all_day: m.all_day,
      host_id: m.host_id,
      channel_id: m.channel_id,
      stream_call_id: m.stream_call_id,
      attendees,
      started_at: m.started_at,
      ended_at: m.ended_at,
      recurrence: (m.recurrence as MeetingRecurrence | null) ?? null,
    };

    // Non-recurring meeting: a single occurrence at the stored times.
    const recurrence = m.recurrence as MeetingRecurrence | null;
    if (!recurrence || !m.scheduled_start || !m.scheduled_end) {
      return [
        {
          ...baseMeeting,
          start: start as string,
          end,
        },
      ];
    }

    // Recurring: expand into materialised occurrences inside the window.
    // The occurrence id is `<meetingId>@<startIso>` so click handlers can
    // still resolve back to the underlying meeting row (everything before
    // the `@`).
    return expandRecurrence(
      {
        id: m.id,
        scheduled_start: m.scheduled_start,
        scheduled_end: m.scheduled_end,
        recurrence,
      },
      windowFrom,
      windowTo,
    ).map((occ) => ({
      ...baseMeeting,
      id: occ.occurrence_id,
      start: occ.scheduled_start,
      end: occ.scheduled_end,
    }));
  });

  const taskEvents: TaskEvent[] = (tasks.data ?? []).map((t) => ({
    source: "task",
    id: t.id,
    title: t.title,
    description: t.description,
    location: null,
    color: null,
    all_day: false,
    start: t.scheduled_start as string,
    end: t.scheduled_end as string,
    status: t.status as TaskEvent["status"],
    priority: t.priority as TaskEvent["priority"],
    assignee_id: t.assignee_id,
    due_at: t.due_at,
  }));

  const externalEvents: ExternalEvent[] = (external.data ?? []).map((e) => {
    const cal = (e.calendar ?? {}) as unknown as {
      id: string;
      color: string | null;
      connection: { provider: "google" | "microsoft" };
    };
    return {
      source: "external",
      id: e.id,
      title: e.title,
      description: e.description,
      location: e.location,
      color: cal.color ?? null,
      all_day: e.all_day,
      start: e.start_at,
      end: e.end_at,
      provider: cal.connection.provider,
      calendar_id: cal.id,
      external_id: e.external_id,
      busy_status: e.busy_status as ExternalEvent["busy_status"],
      html_link: e.html_link,
      organizer_email: e.organizer_email,
    };
  });

  return [...meetingEvents, ...taskEvents, ...externalEvents];
}

/** Connected providers for the current user — drives the "Connected as …" rows. */
export async function getConnections(
  supabase: ServerClient,
  userId: string,
): Promise<ConnectionRow[]> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .select("id, provider, account_email, last_synced_at, last_sync_error")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    provider: c.provider as ConnectionRow["provider"],
    account_email: c.account_email,
    last_synced_at: c.last_synced_at,
    last_sync_error: c.last_sync_error,
  }));
}

/** Calendars the user has connected — toggleable in the section sidebar. */
export async function getCalendarSources(
  supabase: ServerClient,
  userId: string,
): Promise<CalendarSource[]> {
  const { data, error } = await supabase
    .from("external_calendars")
    .select(
      `id, name, color, selected,
       connection:calendar_connections!inner(provider, account_email, user_id)`,
    )
    .eq("connection.user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const externals: CalendarSource[] = (data ?? []).map((c) => {
    const conn = c.connection as unknown as {
      provider: "google" | "microsoft";
      account_email: string;
    };
    return {
      id: c.id,
      kind: conn.provider,
      name: c.name,
      color: c.color,
      selected: c.selected,
      account_email: conn.account_email,
    };
  });

  // Two synthetic rows for the in-app sources so the UI can render a single
  // unified list of "which calendars do I want overlaid." Their ids are
  // namespaced so client-side filtering can route on `kind === "internal"`.
  return [
    {
      id: "internal:meetings",
      kind: "internal",
      name: "Property meetings",
      color: null,
      selected: true,
    },
    {
      id: "internal:tasks",
      kind: "internal",
      name: "Scheduled tasks",
      color: null,
      selected: true,
    },
    ...externals,
  ];
}
