-- Follow-ups to the workflow system (0026 + 0027):
--   1. `tasks.overdue_notified_at` — so the overdue sweep emits at most one
--      task.overdue event per task. Reset to null when the task is reopened.
--   2. `workflow_waits` — tracks suspended `control.wait_for_event` hooks so
--      the dispatcher can correlate incoming workflow_events and auto-resume.
--   3. pg_cron helpers — `workflows_emit_cron_event(workflow_id)`,
--      `workflows_schedule_cron(workflow_id, cron_expression, timezone)`,
--      `workflows_unschedule_cron(workflow_id)`. saveWorkflow calls these
--      via RPC when a workflow's trigger is `schedule.cron`.

-- ============================================================================
-- 1. tasks.overdue_notified_at
-- ============================================================================

alter table public.tasks
  add column if not exists overdue_notified_at timestamptz;

create index if not exists tasks_overdue_candidates_idx
  on public.tasks (property_id, due_at)
  where status <> 'done' and overdue_notified_at is null and due_at is not null;

-- Reset the marker if a task moves back from done → todo etc., so it can be
-- re-flagged the next time it goes overdue.
create or replace function public.tasks_reset_overdue_on_reopen()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'done' and new.status <> 'done' then
    new.overdue_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_overdue_bu on public.tasks;
create trigger tasks_reset_overdue_bu
  before update of status on public.tasks
  for each row execute function public.tasks_reset_overdue_on_reopen();

-- ============================================================================
-- 2. workflow_waits — durable runtime registers a row before suspending,
--    dispatcher matches and resumes via workflow SDK.
-- ============================================================================

create table if not exists public.workflow_waits (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_id text not null,
  property_id uuid not null references public.properties(id) on delete cascade,
  token text not null unique,            -- the createHook token
  event_type text not null,              -- the trigger event we're waiting for
  -- Map of `{ "path.in.payload": "matchValue" }` — all keys must match for
  -- this wait to resume. Null/empty = match any event of this type.
  correlate jsonb not null default '{}'::jsonb,
  timeout_at timestamptz,                -- optional; sweep can wake up expired waits
  created_at timestamptz not null default now()
);

create index if not exists workflow_waits_property_event_idx
  on public.workflow_waits (property_id, event_type);
create index if not exists workflow_waits_token_idx
  on public.workflow_waits (token);

alter table public.workflow_waits enable row level security;
create policy "workflow_waits_select_member" on public.workflow_waits
  for select using (public.is_member(property_id));
-- Inserts + deletes happen via the service role from the runtime; no
-- user-facing write policy needed.

-- ============================================================================
-- 3. pg_cron helpers
-- ============================================================================

create extension if not exists pg_cron with schema extensions;

-- Body invoked by every pg_cron job. Looks up the workflow's property_id
-- and inserts a workflow_events row with source='cron'. The dispatcher's
-- inline-race / cron drain will pick it up.
create or replace function public.workflows_emit_cron_event(p_workflow_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prop_id uuid;
begin
  select property_id into prop_id from public.workflows where id = p_workflow_id;
  if prop_id is null then
    -- Workflow was deleted; nothing to do. The job should have been
    -- unscheduled, but tolerate it.
    return;
  end if;
  insert into public.workflow_events
    (property_id, source, event_type, entity_id, entity_kind, payload)
  values
    (prop_id, 'cron', 'schedule.cron', p_workflow_id, 'workflow',
     jsonb_build_object('workflow_id', p_workflow_id, 'fired_at', now()));
end;
$$;

-- Schedule a pg_cron job for a workflow. Idempotent: unschedules any prior
-- job for this workflow first, then schedules the new one, then updates
-- workflow_schedules with the jobid.
create or replace function public.workflows_schedule_cron(
  p_workflow_id uuid,
  p_cron text,
  p_timezone text default 'UTC'
)
returns bigint
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
declare
  job_name text := 'workflow:' || p_workflow_id::text;
  new_jobid bigint;
  old_jobid bigint;
begin
  -- Drop the previous job if present.
  select pg_cron_jobid into old_jobid from public.workflow_schedules
    where workflow_id = p_workflow_id;
  if old_jobid is not null then
    perform cron.unschedule(old_jobid);
  end if;

  -- Schedule the new job. cron.schedule signature:
  --   cron.schedule(jobname, schedule, command)
  new_jobid := cron.schedule(
    job_name,
    p_cron,
    format('select public.workflows_emit_cron_event(%L::uuid);', p_workflow_id)
  );

  insert into public.workflow_schedules (workflow_id, cron_expression, timezone, pg_cron_jobid)
  values (p_workflow_id, p_cron, p_timezone, new_jobid)
  on conflict (workflow_id) do update
    set cron_expression = excluded.cron_expression,
        timezone = excluded.timezone,
        pg_cron_jobid = excluded.pg_cron_jobid,
        updated_at = now();

  return new_jobid;
end;
$$;

-- Unschedule a workflow's cron job. Safe to call when no job exists.
create or replace function public.workflows_unschedule_cron(p_workflow_id uuid)
returns void
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
declare
  old_jobid bigint;
begin
  select pg_cron_jobid into old_jobid from public.workflow_schedules
    where workflow_id = p_workflow_id;
  if old_jobid is not null then
    perform cron.unschedule(old_jobid);
  end if;
  delete from public.workflow_schedules where workflow_id = p_workflow_id;
end;
$$;
