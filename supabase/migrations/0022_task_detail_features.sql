-- Task detail features: sub-issues, links, relations, labels, favorites,
-- description history, notification mutes, reminders, document links.

-- Sub-issues (self-referencing parent).
alter table public.tasks
  add column parent_id uuid references public.tasks(id) on delete cascade;

alter table public.tasks
  add column labels text[] not null default '{}';

alter table public.tasks
  add column project_name text;

create index tasks_parent_id_idx on public.tasks (parent_id)
  where parent_id is not null;

-- External URLs attached to a task.
create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  url text not null,
  title text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index task_links_task_id_idx on public.task_links (task_id);

-- Related tasks (one directed row; queries check both directions).
create table public.task_relations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  related_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (task_id <> related_task_id),
  unique (task_id, related_task_id)
);

create index task_relations_task_id_idx on public.task_relations (task_id);
create index task_relations_related_task_id_idx on public.task_relations (related_task_id);

-- Per-user favorites.
create table public.task_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

-- Description edit history (populated by trigger below).
create table public.task_description_revisions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  description text,
  edited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index task_description_revisions_task_id_idx
  on public.task_description_revisions (task_id, created_at desc);

-- Per-user mute for task notifications.
create table public.task_notification_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

-- Scheduled reminders (future cron / edge function can deliver).
create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  remind_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index task_reminders_user_remind_at_idx
  on public.task_reminders (user_id, remind_at);

-- Links to property documents.
create table public.task_document_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task_id, document_id)
);

create index task_document_links_task_id_idx on public.task_document_links (task_id);

-- File attachments (storage path in task-attachments bucket).
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  byte_size bigint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index task_attachments_task_id_idx on public.task_attachments (task_id);

-- Save prior description before each change.
create or replace function public.save_task_description_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.description is distinct from new.description then
    insert into public.task_description_revisions (task_id, description, edited_by)
    values (old.id, old.description, auth.uid());
  end if;
  return new;
end;
$$;

create trigger tasks_save_description_revision
  before update of description on public.tasks
  for each row execute function public.save_task_description_revision();

-- ============================================================================
-- RLS — scoped through task membership.
-- ============================================================================

alter table public.task_links enable row level security;
alter table public.task_relations enable row level security;
alter table public.task_favorites enable row level security;
alter table public.task_description_revisions enable row level security;
alter table public.task_notification_mutes enable row level security;
alter table public.task_reminders enable row level security;
alter table public.task_document_links enable row level security;
alter table public.task_attachments enable row level security;

create policy "task_links_member" on public.task_links
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  );

create policy "task_relations_member" on public.task_relations
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  );

create policy "task_favorites_own" on public.task_favorites
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "task_description_revisions_member" on public.task_description_revisions
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  );

create policy "task_notification_mutes_own" on public.task_notification_mutes
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "task_reminders_own" on public.task_reminders
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "task_document_links_member" on public.task_document_links
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  );

create policy "task_attachments_member" on public.task_attachments
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_member(t.property_id)
    )
  );
