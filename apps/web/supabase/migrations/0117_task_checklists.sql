-- 0117 — Per-task checklists (ClickUp parity, Phase 4).
--
-- Temple Point runs a "Task Prep" checklist on every maintenance job and
-- 12-item opening checklists; routines (0082) are per-TEAM recurring lists,
-- not a checklist on one task. A task can carry several named checklists;
-- items nest ONE level (ClickUp's model) and may name an assignee.
--
-- tasks.checklist_total / checklist_done are trigger-maintained counters so
-- cards, the Progress field / column and mobile read "3/7" off the task row
-- with no join (additive columns — older clients ignore them).
--
-- Activity stays quiet: one row when a checklist is added / removed and one
-- when a checklist is COMPLETED (no per-tick noise); completion also emits
-- the workflow event task.checklist_completed.

create table public.task_checklists (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  position    double precision not null default 0,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index task_checklists_task_idx on public.task_checklists (task_id, position);

create table public.task_checklist_items (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.task_checklists(id) on delete cascade,
  task_id        uuid not null references public.tasks(id) on delete cascade,
  property_id    uuid not null references public.properties(id) on delete cascade,
  parent_item_id uuid references public.task_checklist_items(id) on delete cascade,
  text           text not null check (char_length(text) between 1 and 500),
  done           boolean not null default false,
  done_at        timestamptz,
  done_by        uuid references auth.users(id) on delete set null,
  assignee_id    uuid references auth.users(id) on delete set null,
  position       double precision not null default 0,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index task_checklist_items_checklist_idx
  on public.task_checklist_items (checklist_id, position);
create index task_checklist_items_task_idx on public.task_checklist_items (task_id);
create index task_checklist_items_assignee_idx
  on public.task_checklist_items (assignee_id) where assignee_id is not null;

alter table public.tasks
  add column checklist_total integer not null default 0,
  add column checklist_done  integer not null default 0;

-- ── RLS (the 0022 task-membership pattern, property denormalised) ──────────

alter table public.task_checklists enable row level security;
alter table public.task_checklist_items enable row level security;

create policy "task_checklists member" on public.task_checklists
  for all using (public.is_member(property_id))
  with check (
    public.is_member(property_id)
    and exists (select 1 from public.tasks t
                where t.id = task_id and t.property_id = task_checklists.property_id)
  );

create policy "task_checklist_items member" on public.task_checklist_items
  for all using (public.is_member(property_id))
  with check (
    public.is_member(property_id)
    and exists (select 1 from public.task_checklists c
                where c.id = checklist_id
                  and c.task_id = task_checklist_items.task_id
                  and c.property_id = task_checklist_items.property_id)
  );

alter table public.task_checklists replica identity full;
alter table public.task_checklist_items replica identity full;
alter publication supabase_realtime add table public.task_checklists;
alter publication supabase_realtime add table public.task_checklist_items;

-- ── Items: stamps + one level of nesting ────────────────────────────────────

create or replace function public.task_checklist_items_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_item_id is not null then
    if not exists (
      select 1 from public.task_checklist_items p
       where p.id = new.parent_item_id
         and p.checklist_id = new.checklist_id
         and p.parent_item_id is null
    ) then
      raise exception 'checklist items nest one level, inside the same checklist'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := now();
    new.done_by := coalesce(auth.uid(), new.done_by);
  elsif not new.done then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end;
$$;

create trigger task_checklist_items_touch_biu
  before insert or update on public.task_checklist_items
  for each row execute function public.task_checklist_items_touch();

-- ── Counters on tasks + "checklist completed" ───────────────────────────────

create or replace function public.task_checklist_items_recount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  t record;
  cl record;
begin
  update public.tasks
     set checklist_total = (select count(*) from public.task_checklist_items where task_id = tid),
         checklist_done  = (select count(*) from public.task_checklist_items where task_id = tid and done)
   where id = tid
     and (checklist_total, checklist_done) is distinct from (
       (select count(*) from public.task_checklist_items where task_id = tid)::int,
       (select count(*) from public.task_checklist_items where task_id = tid and done)::int);

  -- A tick that finishes a checklist: log + emit once.
  if tg_op = 'UPDATE' and new.done and not old.done
     and not exists (select 1 from public.task_checklist_items
                      where checklist_id = new.checklist_id and not done) then
    select * into t from public.tasks where id = tid;
    select id, name into cl from public.task_checklists where id = new.checklist_id;
    if t.id is not null then
      perform public.log_activity(
        t.property_id, 'task', t.id, t.title, 'checklist_completed',
        jsonb_build_object('checklist_id', cl.id, 'name', cl.name),
        t.project_id, t.space_id);
      perform public.emit_workflow_event(
        t.property_id, 'pg.tasks', 'task.checklist_completed', t.id, 'task',
        jsonb_build_object('checklist_id', cl.id, 'name', cl.name, 'new', to_jsonb(t)));
    end if;
  end if;
  return null;
end;
$$;

create trigger task_checklist_items_recount_aiud
  after insert or update of done, task_id or delete on public.task_checklist_items
  for each row execute function public.task_checklist_items_recount();

-- ── Checklist added / removed ───────────────────────────────────────────────

create or replace function public.task_checklists_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select * into t from public.tasks where id = r.task_id;
  if t.id is null then
    return null; -- the task itself is being deleted
  end if;
  perform public.log_activity(
    t.property_id, 'task', t.id, t.title,
    case when tg_op = 'DELETE' then 'checklist_removed' else 'checklist_added' end,
    jsonb_build_object('checklist_id', r.id, 'name', r.name),
    t.project_id, t.space_id);
  return null;
end;
$$;

create trigger task_checklists_log_activity_aid
  after insert or delete on public.task_checklists
  for each row execute function public.task_checklists_log_activity();
