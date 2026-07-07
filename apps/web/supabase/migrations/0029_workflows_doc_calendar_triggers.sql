-- Postgres triggers that emit workflow_events for documents + external
-- calendar events. Matches the pattern in 0026 for tasks + entities — keeps
-- the outbox the source of truth, regardless of which code path mutated the
-- table.

-- ============================================================================
-- documents — doc.created (INSERT), doc.archived (UPDATE of archived_at)
-- ============================================================================

create or replace function public.documents_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    perform public.emit_workflow_event(
      new.property_id, 'pg.documents', 'doc.created', new.id, 'document',
      jsonb_build_object('document', to_jsonb(new))
    );
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    if old.archived_at is null and new.archived_at is not null then
      perform public.emit_workflow_event(
        new.property_id, 'pg.documents', 'doc.archived', new.id, 'document',
        jsonb_build_object('document', to_jsonb(new))
      );
    end if;
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists documents_workflow_events_aiu on public.documents;
create trigger documents_workflow_events_aiu
  after insert or update on public.documents
  for each row execute function public.documents_emit_workflow_events();

-- ============================================================================
-- external_events — calendar.event.created (INSERT)
-- ============================================================================
--
-- We resolve property_id through external_calendars → calendar_connections,
-- which are user-scoped (not property-scoped). For now, emit ONE event per
-- property the connection's user is a member of. Workflows can filter on
-- payload.user_id or payload.calendar_id if they want narrower scope.

create or replace function public.external_events_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conn_user_id uuid;
  cal_name text;
  prop record;
begin
  if (tg_op <> 'INSERT') then return new; end if;

  -- Trace external_events → external_calendars → calendar_connections.user_id
  select cc.user_id, ec.name
    into conn_user_id, cal_name
  from public.external_calendars ec
  join public.calendar_connections cc on cc.id = ec.connection_id
  where ec.id = new.calendar_id;

  if conn_user_id is null then
    return new;
  end if;

  -- Fan out per property the user belongs to.
  for prop in
    select property_id from public.memberships where user_id = conn_user_id
  loop
    perform public.emit_workflow_event(
      prop.property_id,
      'calendar.google',  -- best-effort source; we don't distinguish providers here
      'calendar.event.created',
      new.id,
      'external_event',
      jsonb_build_object(
        'event', to_jsonb(new),
        'calendar', jsonb_build_object('id', new.calendar_id, 'name', cal_name),
        'user_id', conn_user_id
      )
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists external_events_workflow_events_ai on public.external_events;
create trigger external_events_workflow_events_ai
  after insert on public.external_events
  for each row execute function public.external_events_emit_workflow_events();
