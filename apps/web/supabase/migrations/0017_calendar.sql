-- Calendar: extend `meetings` so a row IS a calendar event with attendees,
-- give `tasks` scheduled_start/scheduled_end so they can be dropped onto the
-- grid as time-blocks, and add the tables that back Google/Outlook sync.
--
-- Data-model intent:
--   * meetings  — the only "event" table. Walk-up calls keep started_at/
--     ended_at = now() with scheduled_start/end null; planned meetings set
--     scheduled_start/end ahead of time and started_at fills in when someone
--     joins. One source of truth, no calendar_events shadow.
--   * meeting_attendees   — invitee list + RSVP. Calendar UI joins through
--     this so a meeting shows on each attendee's calendar without needing a
--     per-user copy of the row.
--   * tasks.scheduled_*   — separate from due_at: due is a deadline, the
--     scheduled window is when work happens. ClickUp ships both.
--   * calendar_connections / external_calendars / external_events — generic
--     enough to back Google or Microsoft; provider-specific tokens (sync
--     tokens, delta links, etag) live in jsonb to keep the schema stable
--     across provider quirks.

-- ============================================================================
-- meetings: turn into a calendar-aware row
-- ============================================================================

alter table public.meetings
  add column scheduled_start timestamptz,
  add column scheduled_end timestamptz,
  add column all_day boolean not null default false,
  add column description text,
  add column location text,
  -- Hex without `#` (e.g. `7c3aed`). Null = use the host's default colour
  -- (assigned client-side from a palette keyed on user id).
  add column color text;

-- A *scheduled* meeting hasn't started until someone joins; the row exists
-- only as a calendar entry. started_at was NOT NULL DEFAULT now() in 0016
-- (walk-up calls had no other lifecycle), but with the calendar path we
-- need to be able to insert a row without a started timestamp. Drop the
-- NOT NULL — the default stays so walk-up inserts behave identically.
alter table public.meetings alter column started_at drop not null;

-- An event is "scheduled" when scheduled_start is non-null. started_at stays
-- the actual join time, which can be earlier (joined early) or later (ran
-- behind). Walk-up meetings keep both null cohorts the same: scheduled_*
-- null, started_at = now(). Calendar queries filter on scheduled_start.
create index meetings_scheduled_idx
  on public.meetings (property_id, scheduled_start)
  where scheduled_start is not null;

-- ============================================================================
-- meeting_attendees
-- ============================================================================

create table public.meeting_attendees (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  response text not null default 'pending'
    check (response in ('pending','accepted','declined','tentative')),
  is_organizer boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

-- (user_id, meeting) lookup for "my calendar" — pull meetings I'm on without
-- a sequential scan of the attendees table.
create index meeting_attendees_user_idx
  on public.meeting_attendees (user_id, meeting_id);

alter table public.meeting_attendees enable row level security;

-- Anyone in the property can see the attendee list; only members can add or
-- remove attendees. Meeting hosts are expected to do this client-side.
create policy "meeting_attendees_select_member" on public.meeting_attendees
  for select using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id and public.is_member(m.property_id)
    )
  );

create policy "meeting_attendees_insert_member" on public.meeting_attendees
  for insert with check (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id and public.is_member(m.property_id)
    )
  );

create policy "meeting_attendees_update_member" on public.meeting_attendees
  for update using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id and public.is_member(m.property_id)
    )
  );

create policy "meeting_attendees_delete_member" on public.meeting_attendees
  for delete using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id and public.is_member(m.property_id)
    )
  );

-- ============================================================================
-- tasks: schedulable time blocks
--
-- `due_at` already exists (a deadline). `scheduled_start`/`scheduled_end`
-- are when the user has committed to *do* the work, surfaced as a draggable
-- block on the calendar grid.
-- ============================================================================

alter table public.tasks
  add column scheduled_start timestamptz,
  add column scheduled_end timestamptz;

create index tasks_scheduled_idx
  on public.tasks (property_id, scheduled_start)
  where scheduled_start is not null;

-- ============================================================================
-- calendar_connections
--
-- One row per (user, provider) — stores the OAuth tokens we got back. Tokens
-- are per-user, not per-property: a user's Google Calendar follows them
-- across every property they belong to. Property scoping for the UI happens
-- at query time, not in storage.
-- ============================================================================

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  -- The external account email/upn — shown in the "Connected as" UI and
  -- used to dedupe a re-connect attempt.
  account_email text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  -- Provider-specific cursors: Google uses syncToken per calendar, Microsoft
  -- uses a delta link. Stored as jsonb so we don't churn the schema if
  -- either side adds a new field.
  sync_state jsonb not null default '{}'::jsonb,
  -- Push subscription metadata (Google channel id + resource id, MS
  -- subscription id + expiration). Stored together so the renew job can
  -- find them by connection.
  push_subscription jsonb,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, account_email)
);

create index calendar_connections_user_idx
  on public.calendar_connections (user_id);

create trigger calendar_connections_set_updated_at
  before update on public.calendar_connections
  for each row execute function public.set_updated_at();

alter table public.calendar_connections enable row level security;

-- Tokens are per-user secrets — readable/writable only by the owning user.
create policy "calendar_connections_select_self" on public.calendar_connections
  for select using (user_id = auth.uid());

create policy "calendar_connections_insert_self" on public.calendar_connections
  for insert with check (user_id = auth.uid());

create policy "calendar_connections_update_self" on public.calendar_connections
  for update using (user_id = auth.uid());

create policy "calendar_connections_delete_self" on public.calendar_connections
  for delete using (user_id = auth.uid());

-- ============================================================================
-- external_calendars
--
-- A user may have many calendars per connection (work, personal, holidays).
-- We list them so the user can pick which ones to overlay.
-- ============================================================================

create table public.external_calendars (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  external_id text not null,
  name text not null,
  description text,
  -- Hex without `#` (provider-supplied).
  color text,
  is_primary boolean not null default false,
  -- User can hide a calendar without disconnecting the whole provider.
  selected boolean not null default true,
  -- Per-calendar sync cursor: Google's syncToken / Microsoft's deltaLink.
  sync_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id)
);

create index external_calendars_connection_idx
  on public.external_calendars (connection_id);

create trigger external_calendars_set_updated_at
  before update on public.external_calendars
  for each row execute function public.set_updated_at();

alter table public.external_calendars enable row level security;

-- Inherits visibility from the parent connection (owner-only).
create policy "external_calendars_select_self" on public.external_calendars
  for select using (
    exists (
      select 1 from public.calendar_connections c
      where c.id = connection_id and c.user_id = auth.uid()
    )
  );

create policy "external_calendars_insert_self" on public.external_calendars
  for insert with check (
    exists (
      select 1 from public.calendar_connections c
      where c.id = connection_id and c.user_id = auth.uid()
    )
  );

create policy "external_calendars_update_self" on public.external_calendars
  for update using (
    exists (
      select 1 from public.calendar_connections c
      where c.id = connection_id and c.user_id = auth.uid()
    )
  );

create policy "external_calendars_delete_self" on public.external_calendars
  for delete using (
    exists (
      select 1 from public.calendar_connections c
      where c.id = connection_id and c.user_id = auth.uid()
    )
  );

-- ============================================================================
-- external_events
--
-- Cached events synced from external providers. We don't try to two-way
-- sync every field — only the bits the calendar grid actually renders. The
-- source provider stays authoritative; this table is a read mirror.
-- ============================================================================

create table public.external_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.external_calendars(id) on delete cascade,
  external_id text not null,
  title text not null default '',
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  -- Provider-side change token to skip writes when the event hasn't changed.
  etag text,
  -- "confirmed" | "tentative" | "cancelled" — provider value passed through.
  status text not null default 'confirmed',
  -- "free" | "busy" — affects free-time computation in the team view.
  busy_status text not null default 'busy'
    check (busy_status in ('free','busy','tentative','oof','workingElsewhere')),
  html_link text,
  organizer_email text,
  organizer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, external_id)
);

-- The grid query is always (calendar set, time window): cover both via the
-- calendar index plus a (calendar, start) index for the window scan.
create index external_events_calendar_idx
  on public.external_events (calendar_id);
create index external_events_calendar_start_idx
  on public.external_events (calendar_id, start_at);

create trigger external_events_set_updated_at
  before update on public.external_events
  for each row execute function public.set_updated_at();

alter table public.external_events enable row level security;

create policy "external_events_select_self" on public.external_events
  for select using (
    exists (
      select 1 from public.external_calendars ec
      join public.calendar_connections c on c.id = ec.connection_id
      where ec.id = calendar_id and c.user_id = auth.uid()
    )
  );

create policy "external_events_insert_self" on public.external_events
  for insert with check (
    exists (
      select 1 from public.external_calendars ec
      join public.calendar_connections c on c.id = ec.connection_id
      where ec.id = calendar_id and c.user_id = auth.uid()
    )
  );

create policy "external_events_update_self" on public.external_events
  for update using (
    exists (
      select 1 from public.external_calendars ec
      join public.calendar_connections c on c.id = ec.connection_id
      where ec.id = calendar_id and c.user_id = auth.uid()
    )
  );

create policy "external_events_delete_self" on public.external_events
  for delete using (
    exists (
      select 1 from public.external_calendars ec
      join public.calendar_connections c on c.id = ec.connection_id
      where ec.id = calendar_id and c.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Realtime
--
-- The calendar grid invalidates on:
--   * meetings (already added in 0016) — new/updated event
--   * meeting_attendees — RSVP / attendee added or removed
--   * external_events — provider sync wrote rows
-- tasks is already on the publication via the kanban work.
-- ============================================================================

alter publication supabase_realtime add table public.meeting_attendees;
alter publication supabase_realtime add table public.external_events;
