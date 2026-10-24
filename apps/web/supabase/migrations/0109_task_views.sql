-- Saved task views (gr8r-studio parity pass, 2026-10-23).
--
-- A view is a named filter + layout a person (or the whole property, when
-- `shared`) can reopen from the Tasks sidebar: "Housekeeping · blocked",
-- "My urgent this week". `filters` mirrors the board's client-side filter
-- state (`components/tasks/board-filters.tsx`) as JSON so adding a facet
-- there needs no migration; unknown keys are ignored on load.

create table public.task_views (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  icon text,
  -- board | list | timeline | workload
  layout text not null default 'board'
    check (layout in ('board', 'list', 'timeline', 'workload')),
  filters jsonb not null default '{}'::jsonb,
  -- Visible to every member of the property (false = personal).
  shared boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index task_views_property_idx on public.task_views (property_id, shared, position);
create index task_views_user_idx on public.task_views (user_id, property_id);

alter table public.task_views enable row level security;

create policy task_views_select on public.task_views
  for select using (
    public.is_member(property_id)
    and (shared or user_id = (select auth.uid()))
  );
create policy task_views_insert on public.task_views
  for insert with check (
    public.is_member(property_id) and user_id = (select auth.uid())
  );
-- Edit/delete: the creator, or an owner/manager for shared views.
create policy task_views_update on public.task_views
  for update using (
    public.is_member(property_id)
    and (user_id = (select auth.uid())
         or (shared and exists (
           select 1 from public.memberships m
           where m.property_id = task_views.property_id
             and m.user_id = (select auth.uid())
             and m.role in ('owner', 'manager')
         )))
  );
create policy task_views_delete on public.task_views
  for delete using (
    public.is_member(property_id)
    and (user_id = (select auth.uid())
         or (shared and exists (
           select 1 from public.memberships m
           where m.property_id = task_views.property_id
             and m.user_id = (select auth.uid())
             and m.role in ('owner', 'manager')
         )))
  );

drop trigger if exists task_views_set_updated_at on public.task_views;
create trigger task_views_set_updated_at
  before update on public.task_views
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.task_views;
