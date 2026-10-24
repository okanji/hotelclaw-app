-- Notification preferences + due-soon reminders (gr8r parity pass, 2026-10-23).
--
-- `notification_prefs` is one row per (user, property): which in-app
-- notification types to mute, and whether/when to be reminded before a task
-- is due. Muting is enforced at the source — a BEFORE INSERT trigger on
-- `notifications` drops muted rows, so every writer (server actions, bots,
-- workflows, crons) honours it without a code change.
--
-- Due reminders: `/api/tasks/due-reminders` (cron, every 10 min) inserts a
-- `task_due_soon` notification for the assignee once per task, stamped in
-- `tasks.due_reminder_sent_at`; moving the due date re-arms it.

create table public.notification_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- notification.type values to drop (e.g. 'briefing', 'task_due_soon').
  muted_types text[] not null default '{}',
  due_reminders_enabled boolean not null default true,
  -- Hours before due_at to remind (1–168).
  due_reminder_hours integer not null default 24
    check (due_reminder_hours between 1 and 168),
  updated_at timestamptz not null default now(),
  primary key (user_id, property_id)
);

alter table public.notification_prefs enable row level security;

create policy notification_prefs_own on public.notification_prefs
  for all using (user_id = (select auth.uid()) and public.is_member(property_id))
  with check (user_id = (select auth.uid()) and public.is_member(property_id));

drop trigger if exists notification_prefs_set_updated_at on public.notification_prefs;
create trigger notification_prefs_set_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();

-- Enforce mutes at the source.
create or replace function public.notifications_apply_mutes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.property_id is not null and exists (
    select 1 from public.notification_prefs p
    where p.user_id = new.user_id
      and p.property_id = new.property_id
      and new.type = any (p.muted_types)
  ) then
    return null; -- silently dropped
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_apply_mutes_bi on public.notifications;
create trigger notifications_apply_mutes_bi
  before insert on public.notifications
  for each row execute function public.notifications_apply_mutes();

-- Due reminders
alter table public.tasks
  add column if not exists due_reminder_sent_at timestamptz;

create index if not exists tasks_due_reminder_candidates_idx
  on public.tasks (due_at)
  where due_reminder_sent_at is null
    and due_at is not null
    and assignee_id is not null
    and status <> 'done'
    and archived_at is null;

create or replace function public.tasks_reset_due_reminder()
returns trigger
language plpgsql
as $$
begin
  if old.due_at is distinct from new.due_at then
    new.due_reminder_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_due_reminder_bu on public.tasks;
create trigger tasks_reset_due_reminder_bu
  before update of due_at on public.tasks
  for each row execute function public.tasks_reset_due_reminder();
