-- Follow-up to 0017_calendar:
--   * Team free/busy: a SECURITY DEFINER function that returns only
--     (user_id, start, end, busy) tuples for a list of users in a window.
--     RLS keeps users from reading each other's `external_events` rows
--     directly; this function explicitly opts out so the calendar can
--     render free/busy bars without leaking event contents.
--   * Recurring meetings: `recurrence` jsonb on `meetings`. The shape is
--     `{frequency, interval, until?, count?, byday?}` — a thin RRULE
--     subset that covers daily/weekly/monthly standups without dragging
--     in a full RRULE parser. The server expander uses this to materialise
--     occurrences inside the calendar grid's query window.
--   * Push subscription bookkeeping: keep the column we already have on
--     `calendar_connections`, but add an `expires_at` next to it so the
--     renewal cron can find rows that need touching (a sub-column on
--     jsonb works but indexing is annoying).

-- ============================================================================
-- free_busy(user_ids uuid[], from_ts timestamptz, to_ts timestamptz)
-- ============================================================================

create or replace function public.calendar_free_busy(
  user_ids uuid[],
  from_ts timestamptz,
  to_ts timestamptz,
  property_id uuid
)
returns table (
  user_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  busy text  -- 'busy' | 'tentative' | 'free'
)
language sql
stable
security definer
set search_path = public
as $$
  with caller_membership as (
    select 1
    where public.is_member(property_id)
  ),
  meeting_busy as (
    -- A meeting blocks each attendee's calendar in [scheduled_start, end).
    -- We only expose meetings inside the same property to enforce the
    -- "you can see members of your own property" trust boundary — without
    -- this guard, a user in property A could probe another user in
    -- property B's free/busy.
    select
      ma.user_id,
      m.scheduled_start as start_at,
      m.scheduled_end as end_at,
      case ma.response
        when 'declined' then 'free'
        when 'tentative' then 'tentative'
        else 'busy'
      end::text as busy
    from meeting_attendees ma
    join meetings m on m.id = ma.meeting_id
    where m.scheduled_start is not null
      and m.scheduled_end is not null
      and m.property_id = calendar_free_busy.property_id
      and ma.user_id = any(user_ids)
      and m.scheduled_start < to_ts
      and m.scheduled_end > from_ts
  ),
  external_busy as (
    -- A user's external (Google/Outlook) events. We never return the
    -- title/description — just the time window and a free/busy flag.
    select
      cc.user_id,
      ee.start_at,
      ee.end_at,
      case ee.busy_status
        when 'free' then 'free'
        when 'tentative' then 'tentative'
        else 'busy'
      end::text as busy
    from external_events ee
    join external_calendars ec on ec.id = ee.calendar_id
    join calendar_connections cc on cc.id = ec.connection_id
    where cc.user_id = any(user_ids)
      and ec.selected = true
      and ee.start_at < to_ts
      and ee.end_at > from_ts
  )
  select * from meeting_busy
  where exists (select 1 from caller_membership)
  union all
  select * from external_busy
  where exists (select 1 from caller_membership);
$$;

-- Lock down execution to authenticated callers. The function still
-- re-checks property membership internally via `public.is_member`.
revoke all on function public.calendar_free_busy(uuid[], timestamptz, timestamptz, uuid) from public;
grant execute on function public.calendar_free_busy(uuid[], timestamptz, timestamptz, uuid) to authenticated;

-- ============================================================================
-- meetings.recurrence
-- ============================================================================

alter table public.meetings
  add column recurrence jsonb;

-- Index over the property + scheduled_start window already covers the
-- common case; the recurrence expander reads the column inline.

-- ============================================================================
-- calendar_connections.push_expires_at
--
-- Mirror the expiration timestamp of the underlying push channel (Google
-- channel.expiration or Microsoft subscription.expirationDateTime) so the
-- renewal cron can find rows nearing expiry without parsing jsonb.
-- ============================================================================

alter table public.calendar_connections
  add column push_expires_at timestamptz;

create index calendar_connections_push_expiring_idx
  on public.calendar_connections (push_expires_at)
  where push_expires_at is not null;
