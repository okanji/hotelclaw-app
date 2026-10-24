-- Task archive + human task keys (gr8r-studio parity pass, 2026-10-23).
--
-- 1. `tasks.archived_at` — soft delete. Deleting a task today is a hard
--    delete behind a window.confirm; archiving keeps the row (history,
--    activity_log, relations) and is undoable from a toast. The board/list
--    queries exclude archived rows; an "Archived" view lists them.
-- 2. Human task keys — `HC-142` instead of a display-only UUID slice.
--    `properties.task_prefix` (2–5 upper-case letters, per property) +
--    `properties.task_counter` + `tasks.number` assigned by a BEFORE INSERT
--    trigger (row-locked increment on the property row, so concurrent
--    inserts never share a number). Existing tasks are back-numbered in
--    creation order.

-- ── Archive ─────────────────────────────────────────────────────────────────

alter table public.tasks
  add column if not exists archived_at timestamptz;

create index if not exists tasks_archived_idx
  on public.tasks (property_id, archived_at desc)
  where archived_at is not null;

-- Activity log: archived / restored verbs (second trigger so 0106's
-- per-field function stays untouched).
create or replace function public.tasks_log_archive_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.archived_at is distinct from new.archived_at then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title,
      case when new.archived_at is null then 'restored' else 'archived' end,
      jsonb_build_object('status', new.status),
      new.project_id, new.space_id);
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_log_archive_activity_au on public.tasks;
create trigger tasks_log_archive_activity_au
  after update of archived_at on public.tasks
  for each row execute function public.tasks_log_archive_activity();

-- ── Human keys ──────────────────────────────────────────────────────────────

alter table public.properties
  add column if not exists task_prefix text not null default 'HC'
    check (task_prefix ~ '^[A-Z]{2,5}$'),
  add column if not exists task_counter integer not null default 0;

-- Derive a prefix from the property name once (e.g. "Grand Hotel Vienna" →
-- GHV, "Seaside" → SEA). Falls back to HC when the name yields <2 letters.
update public.properties p
set task_prefix = sub.prefix
from (
  select id,
         case
           when array_length(words, 1) >= 2
             then upper(left(array_to_string(array(select left(w, 1) from unnest(words) w), ''), 5))
           else upper(left(coalesce(words[1], ''), 3))
         end as prefix
  from (
    select id,
           array_remove(regexp_split_to_array(regexp_replace(name, '[^A-Za-z ]', '', 'g'), '\s+'), '') as words
    from public.properties
  ) s
) sub
where p.id = sub.id
  and sub.prefix ~ '^[A-Z]{2,5}$';

alter table public.tasks
  add column if not exists number integer;

-- Back-number existing tasks in creation order per property.
with numbered as (
  select id,
         row_number() over (partition by property_id order by created_at, id) as rn
  from public.tasks
  where number is null
)
update public.tasks t
set number = numbered.rn
from numbered
where t.id = numbered.id;

update public.properties p
set task_counter = coalesce((select max(number) from public.tasks t where t.property_id = p.id), 0);

alter table public.tasks alter column number set not null;

create unique index if not exists tasks_property_number_key
  on public.tasks (property_id, number);

create or replace function public.tasks_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null then
    update public.properties
      set task_counter = task_counter + 1
      where id = new.property_id
      returning task_counter into new.number;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assign_number_bi on public.tasks;
create trigger tasks_assign_number_bi
  before insert on public.tasks
  for each row execute function public.tasks_assign_number();

comment on column public.tasks.number is
  'Per-property sequential key (shown as <properties.task_prefix>-<number>). Assigned by tasks_assign_number_bi; never reused.';
