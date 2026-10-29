-- 0115 — Multiple assignees per task (ClickUp parity, Phase 2).
--
-- The SET lives in task_assignees; tasks.assignee_id stays as the derived
-- PRIMARY (lowest position, then earliest) so every legacy reader, the REST /
-- mobile contract, the escalate ladder and insights keep working unchanged.
--
-- Two-way sync, and the app writes exactly ONE of the two per statement:
--   * a write to tasks.assignee_id (legacy path: createTaskFor, recurrence,
--     workflow runners, AI update_task assignee_name, triage accept, mobile
--     PATCH) is mirrored into the set: INSERT seeds the row, NULL clears the
--     set, X replaces the old primary (X goes first, the others stay);
--   * a write to task_assignees recomputes tasks.assignee_id.
-- The hop back is silenced with a transaction-local GUC
-- (hotelclaw.assignee_sync), not pg_trigger_depth(): a task inserted by an
-- RPC or another trigger must still be mirrored.
--
-- Activity + workflow events for assignment now come from task_assignees:
-- exactly one `assigned` / `unassigned` row and one task.assigned /
-- task.unassigned event per PERSON. The seed row written for a task INSERT is
-- silent (the `created` row already carries assignee_id, and task.created
-- already fired) — same as before this migration.
--
-- Restates the FULL bodies of tasks_emit_workflow_events + tasks_log_activity
-- as of 0114 minus their assignee branches (G6: create or replace is
-- whole-function).

create table public.task_assignees (
  task_id     uuid not null references public.tasks(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  position    integer not null default 0,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_assignees_user_property_idx
  on public.task_assignees (user_id, property_id);
create index task_assignees_property_idx on public.task_assignees (property_id);

alter table public.task_assignees enable row level security;

-- The 0022 task-membership pattern, plus: the row's property must be the
-- task's, and the person must belong to it.
create policy "task_assignees select member" on public.task_assignees
  for select using (public.is_member(property_id));
create policy "task_assignees insert member" on public.task_assignees
  for insert with check (
    public.is_member(property_id)
    and exists (select 1 from public.tasks t
                where t.id = task_id and t.property_id = task_assignees.property_id)
    and exists (select 1 from public.memberships m
                where m.property_id = task_assignees.property_id
                  and m.user_id = task_assignees.user_id)
  );
create policy "task_assignees update member" on public.task_assignees
  for update using (public.is_member(property_id))
  with check (public.is_member(property_id));
create policy "task_assignees delete member" on public.task_assignees
  for delete using (public.is_member(property_id));

alter table public.task_assignees replica identity full;
alter publication supabase_realtime add table public.task_assignees;

-- Backfill: today's single assignee becomes position 0. Silent (no triggers yet).
insert into public.task_assignees (task_id, user_id, property_id, position, created_by, created_at)
select t.id, t.assignee_id, t.property_id, 0, null, coalesce(t.updated_at, t.created_at)
from public.tasks t
where t.assignee_id is not null
  and exists (select 1 from auth.users u where u.id = t.assignee_id)
on conflict do nothing;

-- ── set → primary ───────────────────────────────────────────────────────────

create or replace function public.task_assignees_sync_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  primary_id uuid;
begin
  select user_id into primary_id
    from public.task_assignees
   where task_id = tid
   order by position, created_at, user_id
   limit 1;
  if exists (select 1 from public.tasks
              where id = tid and assignee_id is distinct from primary_id) then
    perform set_config('hotelclaw.assignee_sync', 'on', true);
    update public.tasks set assignee_id = primary_id where id = tid;
    perform set_config('hotelclaw.assignee_sync', '', true);
  end if;
  return null;
end;
$$;

create trigger task_assignees_sync_primary_aiud
  after insert or update or delete on public.task_assignees
  for each row execute function public.task_assignees_sync_primary();

-- ── primary → set (legacy writes) ───────────────────────────────────────────

create or replace function public.tasks_sync_assignee_set()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  front integer;
begin
  if coalesce(current_setting('hotelclaw.assignee_sync', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      perform set_config('hotelclaw.assignee_seed', 'on', true);
      insert into public.task_assignees (task_id, user_id, property_id, position)
      values (new.id, new.assignee_id, new.property_id, 0)
      on conflict do nothing;
      perform set_config('hotelclaw.assignee_seed', '', true);
    end if;
    return null;
  end if;

  -- UPDATE OF assignee_id
  if old.assignee_id is not distinct from new.assignee_id then
    return null;
  end if;
  if new.assignee_id is null then
    delete from public.task_assignees where task_id = new.id;
    return null;
  end if;

  select coalesce(min(position), 0) - 1 into front
    from public.task_assignees where task_id = new.id;
  insert into public.task_assignees (task_id, user_id, property_id, position)
  values (new.id, new.assignee_id, new.property_id, front)
  on conflict (task_id, user_id) do update set position = excluded.position;
  if old.assignee_id is not null then
    delete from public.task_assignees
     where task_id = new.id and user_id = old.assignee_id;
  end if;
  return null;
end;
$$;

create trigger tasks_sync_assignee_set_aiu
  after insert or update of assignee_id on public.tasks
  for each row execute function public.tasks_sync_assignee_set();

-- ── activity + workflow events, one per person ──────────────────────────────

create or replace function public.task_assignees_log_and_emit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  tid uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
begin
  if tg_op = 'INSERT'
     and coalesce(current_setting('hotelclaw.assignee_seed', true), '') = 'on' then
    return null;
  end if;
  -- A cascade from a task delete: the task row is already gone; the
  -- `deleted` activity row says everything.
  select * into t from public.tasks where id = tid;
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform public.log_activity(
      t.property_id, 'task', t.id, t.title, 'assigned',
      jsonb_build_object('from', null, 'to', new.user_id, 'user_id', new.user_id),
      t.project_id, t.space_id);
    perform public.emit_workflow_event(
      t.property_id, 'pg.tasks', 'task.assigned', t.id, 'task',
      jsonb_build_object('new', to_jsonb(t), 'from', null, 'to', new.user_id,
                         'assignee_ids', (select coalesce(jsonb_agg(user_id order by position, created_at), '[]'::jsonb)
                                            from public.task_assignees where task_id = t.id)));
  elsif tg_op = 'DELETE' then
    perform public.log_activity(
      t.property_id, 'task', t.id, t.title, 'unassigned',
      jsonb_build_object('from', old.user_id, 'to', null, 'user_id', old.user_id),
      t.project_id, t.space_id);
    perform public.emit_workflow_event(
      t.property_id, 'pg.tasks', 'task.unassigned', t.id, 'task',
      jsonb_build_object('new', to_jsonb(t), 'from', old.user_id, 'to', null,
                         'assignee_ids', (select coalesce(jsonb_agg(user_id order by position, created_at), '[]'::jsonb)
                                            from public.task_assignees where task_id = t.id)));
  end if;
  return null;
end;
$$;

create trigger task_assignees_log_and_emit_aid
  after insert or delete on public.task_assignees
  for each row execute function public.task_assignees_log_and_emit();

-- ── restated (0114 minus the assignee branches) ─────────────────────────────

create or replace function public.tasks_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  added_labels text[];
  from_st record;
  to_st record;
begin
  if (tg_op = 'INSERT') then
    perform public.emit_workflow_event(
      new.property_id, 'pg.tasks', 'task.created', new.id, 'task',
      jsonb_build_object('new', to_jsonb(new))
    );
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    if old.status_id is distinct from new.status_id then
      select name, category, is_blocked into from_st from public.statuses where id = old.status_id;
      select name, category, is_blocked into to_st from public.statuses where id = new.status_id;
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.status_changed', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           -- legacy literals: saved workflow filters match on these
                           'from', old.status, 'to', new.status,
                           'from_status_id', old.status_id, 'to_status_id', new.status_id,
                           'from_name', from_st.name, 'to_name', to_st.name,
                           'from_category', from_st.category, 'to_category', to_st.category,
                           'to_blocked', coalesce(to_st.is_blocked, false))
      );
    end if;
    -- task.assigned / task.unassigned moved to task_assignees (0115): one
    -- event per PERSON added or removed, whichever table the app wrote.
    -- label_added: emit one event per newly-added label
    select array_agg(l) into added_labels
    from unnest(coalesce(new.labels, '{}')) l
    where l <> all (coalesce(old.labels, '{}'));
    if added_labels is not null then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.label_added', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'added_labels', to_jsonb(added_labels))
      );
    end if;
    if old.space_id is distinct from new.space_id then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.added_to_space', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.space_id, 'to', new.space_id)
      );
    end if;
    if old.project_id is distinct from new.project_id then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.added_to_project', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.project_id, 'to', new.project_id)
      );
    end if;
    if old.list_id is distinct from new.list_id then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.moved_to_list', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.list_id, 'to', new.list_id)
      );
    end if;
    return new;
  end if;

  return null;
end;
$$;

create or replace function public.tasks_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  added text[];
  removed text[];
  kind_override text;
  from_st record;
  to_st record;
begin
  if tg_op = 'INSERT' then
    kind_override := case new.source when 'workflow' then 'workflow' when 'ai' then 'ai' else null end;
    select name into to_st from public.statuses where id = new.status_id;
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'created',
      jsonb_build_object('status', new.status, 'status_name', to_st.name,
                         'priority', new.priority,
                         'assignee_id', new.assignee_id, 'due_at', new.due_at,
                         'parent_id', new.parent_id, 'list_id', new.list_id),
      new.project_id, new.space_id, kind_override);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.log_activity(
      old.property_id, 'task', old.id, old.title, 'deleted',
      jsonb_build_object('status', old.status), old.project_id, old.space_id);
    return old;
  end if;

  -- UPDATE: one row per changed field, so feeds can filter by verb.
  if old.status_id is distinct from new.status_id then
    select name, category into from_st from public.statuses where id = old.status_id;
    select name, category into to_st from public.statuses where id = new.status_id;
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title,
      case when old.completed_at is null and new.completed_at is not null then 'completed'
           when old.completed_at is not null and new.completed_at is null then 'reopened'
           else 'status_changed' end,
      jsonb_build_object('from', old.status, 'to', new.status,
                         'from_name', from_st.name, 'to_name', to_st.name,
                         'from_category', from_st.category, 'to_category', to_st.category),
      new.project_id, new.space_id);
  end if;
  if old.priority is distinct from new.priority then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'priority_changed',
      jsonb_build_object('from', old.priority, 'to', new.priority),
      new.project_id, new.space_id);
  end if;
  -- assigned / unassigned rows are written by task_assignees (0115), one
  -- per person, so the legacy column and the set never double-log.
  if old.due_at is distinct from new.due_at then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'due_changed',
      jsonb_build_object('from', old.due_at, 'to', new.due_at),
      new.project_id, new.space_id);
  end if;
  if old.scheduled_start is distinct from new.scheduled_start
     or old.scheduled_end is distinct from new.scheduled_end then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'scheduled',
      jsonb_build_object('from_start', old.scheduled_start, 'from_end', old.scheduled_end,
                         'to_start', new.scheduled_start, 'to_end', new.scheduled_end),
      new.project_id, new.space_id);
  end if;
  if old.title is distinct from new.title then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'renamed',
      jsonb_build_object('from', old.title, 'to', new.title),
      new.project_id, new.space_id);
  end if;
  if old.description is distinct from new.description then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'description_changed',
      '{}'::jsonb, new.project_id, new.space_id);
  end if;
  if old.labels is distinct from new.labels then
    select array_agg(l) into added
      from unnest(coalesce(new.labels, '{}')) l where l <> all (coalesce(old.labels, '{}'));
    select array_agg(l) into removed
      from unnest(coalesce(old.labels, '{}')) l where l <> all (coalesce(new.labels, '{}'));
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'labels_changed',
      jsonb_build_object('added', coalesce(to_jsonb(added), '[]'::jsonb),
                         'removed', coalesce(to_jsonb(removed), '[]'::jsonb)),
      new.project_id, new.space_id);
  end if;
  if old.project_id is distinct from new.project_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'project_changed',
      jsonb_build_object('from', old.project_id, 'to', new.project_id),
      new.project_id, new.space_id);
    -- The project it LEFT should also see the departure in its feed.
    if old.project_id is not null then
      perform public.log_activity(
        new.property_id, 'task', new.id, new.title, 'project_removed',
        jsonb_build_object('from', old.project_id, 'to', new.project_id),
        old.project_id, new.space_id);
    end if;
  end if;
  if old.space_id is distinct from new.space_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'space_changed',
      jsonb_build_object('from', old.space_id, 'to', new.space_id),
      new.project_id, new.space_id);
  end if;
  if old.list_id is distinct from new.list_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'list_changed',
      jsonb_build_object('from', old.list_id, 'to', new.list_id),
      new.project_id, new.space_id);
  end if;
  if old.parent_id is distinct from new.parent_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'parent_changed',
      jsonb_build_object('from', old.parent_id, 'to', new.parent_id),
      new.project_id, new.space_id);
  end if;
  return new;
end;
$$;
