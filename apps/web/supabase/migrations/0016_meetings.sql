-- Stream Video meetings: in-app video calls with auto-transcription and
-- AI-generated summaries. Sibling to huddles (audio_room) but a distinct
-- product surface: meetings are persistent, listed in a "Meeting notes" page,
-- and produce a transcript + summary that posts back to the originating
-- channel.
--
-- Three tables instead of one fat row so the lifecycle stages don't fight
-- each other:
--   * meetings           — the call, opened the moment "Start meeting" fires
--   * meeting_transcripts — raw JSONL from Stream's transcription_ready webhook
--   * meeting_summaries   — Claude-generated structured notes
-- The transcript row arrives minutes after the meeting ends; the summary row
-- arrives after that. Splitting them keeps each insert independent and lets
-- the UI render partial state ("transcript ready, summary processing…").

-- ============================================================================
-- meetings
-- ============================================================================

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Channel that initiated the meeting (system summary message lands here).
  -- Nullable because we want the row to survive channel archival.
  channel_id uuid references public.chat_channels(id) on delete set null,
  -- Stream Video call id (e.g. `meeting-<uuid>`). Globally unique within
  -- Stream — the (call_type, call_id) tuple is unique but `default` is the
  -- only call_type we use for meetings, so just call_id is enough.
  stream_call_id text not null unique,
  stream_call_type text not null default 'default',
  title text not null default 'Untitled meeting',
  host_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meetings_property_recent_idx
  on public.meetings (property_id, started_at desc);

create index meetings_channel_idx
  on public.meetings (channel_id, started_at desc)
  where channel_id is not null;

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

alter table public.meetings enable row level security;

create policy "meetings_select_member" on public.meetings
  for select using (public.is_member(property_id));

create policy "meetings_insert_member" on public.meetings
  for insert with check (public.is_member(property_id));

-- Hosts can rename / mark ended. Anyone in the property can join (Stream
-- enforces the call-level permission), but only members can update metadata.
create policy "meetings_update_member" on public.meetings
  for update using (public.is_member(property_id));

-- ============================================================================
-- meeting_transcripts
--
-- One row per transcription artifact. Stream Video can fire transcription_ready
-- more than once for a long call (one per session), so we allow multiple rows
-- per meeting and order by created_at.
-- ============================================================================

create table public.meeting_transcripts (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  -- Signed JSONL URL from the webhook. Expires; we mirror the content into
  -- raw_jsonl so the summary worker has a stable source even if we miss the
  -- window.
  source_url text not null,
  -- Inline copy of the JSONL. Compressed automatically by toast — typical
  -- 30min meeting is well under 1MB. If a transcript blows past 10MB we'll
  -- start streaming to storage instead, but that's a later problem.
  raw_jsonl text,
  -- Snapshot of speakers for fast list rendering (avoid parsing JSONL just to
  -- show "Alice, Bob, Charlie" in the list).
  speakers jsonb not null default '[]'::jsonb,
  duration_seconds integer,
  status text not null default 'pending'
    check (status in ('pending', 'fetched', 'failed')),
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create index meeting_transcripts_meeting_idx
  on public.meeting_transcripts (meeting_id, created_at desc);

alter table public.meeting_transcripts enable row level security;

-- Read-through to meetings.property_id for membership checks.
create policy "meeting_transcripts_select_member" on public.meeting_transcripts
  for select using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id and public.is_member(m.property_id)
    )
  );

-- No client-side insert: the webhook + summarization worker uses the service
-- role to write rows.

-- ============================================================================
-- meeting_summaries
--
-- One row per (meeting, model) — keeps a history if we re-summarize with a
-- newer model. Latest by created_at wins in the UI.
-- ============================================================================

create table public.meeting_summaries (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  transcript_id uuid references public.meeting_transcripts(id) on delete set null,
  model text not null,
  -- Human-readable markdown summary. Posted into chat verbatim.
  summary_md text not null,
  -- Structured outputs. UI renders these as checkboxes / chips.
  action_items jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  -- If we also persisted a document for the property, the id goes here so we
  -- can show "Open notes →".
  document_id uuid references public.documents(id) on delete set null,
  -- Stream chat message id of the system message we posted. Lets us avoid
  -- double-posting if the worker retries.
  chat_message_id text,
  created_at timestamptz not null default now()
);

create index meeting_summaries_meeting_idx
  on public.meeting_summaries (meeting_id, created_at desc);

alter table public.meeting_summaries enable row level security;

create policy "meeting_summaries_select_member" on public.meeting_summaries
  for select using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id and public.is_member(m.property_id)
    )
  );

-- ============================================================================
-- Realtime
--
-- meetings: insert + update so a new meeting appears in everyone's "Active
-- meetings" badge and the end timestamp propagates.
-- meeting_summaries: insert only — when the worker finishes, the UI flips
-- from "Generating summary…" to the rendered summary in real time.
-- ============================================================================

alter publication supabase_realtime add table public.meetings;
alter publication supabase_realtime add table public.meeting_summaries;
