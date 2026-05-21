/**
 * Shared types for the calendar surface — the unified event shape the grid
 * renders, the source-of-origin tag (meeting vs task vs external) so click
 * handlers can route to the right detail/dialog, and the wire shapes the
 * `/api/properties/[id]/calendar` endpoint returns.
 *
 * Three flavours of "event" can land on the grid. They share the timing and
 * label fields the grid needs to lay them out, then carry source-specific
 * metadata via a discriminated union — the consumer narrows by `source`
 * before reaching for fields specific to one kind.
 */

export type CalendarEventSource = "meeting" | "task" | "external";

export type AttendeeResponse = "pending" | "accepted" | "declined" | "tentative";

export type CalendarAttendee = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  response: AttendeeResponse;
  is_organizer: boolean;
};

type BaseEvent = {
  id: string;
  /** ISO timestamp. */
  start: string;
  /** ISO timestamp. For all-day events this is exclusive (end of day). */
  end: string;
  all_day: boolean;
  title: string;
  description: string | null;
  location: string | null;
  /** Hex without `#`, or null to fall back to the source's palette colour. */
  color: string | null;
};

export type MeetingEvent = BaseEvent & {
  source: "meeting";
  host_id: string | null;
  channel_id: string | null;
  stream_call_id: string;
  attendees: CalendarAttendee[];
  /** Set once the host actually started the call. */
  started_at: string | null;
  ended_at: string | null;
};

export type TaskEvent = BaseEvent & {
  source: "task";
  status: "todo" | "in_progress" | "blocked" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  assignee_id: string | null;
  due_at: string | null;
};

export type ExternalEvent = BaseEvent & {
  source: "external";
  provider: "google" | "microsoft";
  /** Owning calendar id (so we can dim if the user untoggles the calendar). */
  calendar_id: string;
  external_id: string;
  busy_status:
    | "free"
    | "busy"
    | "tentative"
    | "oof"
    | "workingElsewhere";
  html_link: string | null;
  organizer_email: string | null;
};

export type CalendarEvent = MeetingEvent | TaskEvent | ExternalEvent;

/** The blob the section sidebar's "calendars" list renders. */
export type CalendarSource = {
  id: string;
  /** "internal" rows are derived (e.g. "Property meetings", "My tasks"); the
   *  rest mirror `external_calendars` rows. */
  kind: "internal" | "google" | "microsoft";
  name: string;
  color: string | null;
  selected: boolean;
  account_email?: string;
};

export type ConnectionRow = {
  id: string;
  provider: "google" | "microsoft";
  account_email: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
};

/** Query range — half-open `[from, to)`. */
export type CalendarRange = {
  from: string;
  to: string;
};
