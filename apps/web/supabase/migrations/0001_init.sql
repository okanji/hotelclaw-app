-- Hotelclaw stage 1 schema
-- Multi-tenant: workspace = property (hotel/restaurant). RLS enforces tenancy.

create extension if not exists "pgcrypto";

-- ============================================================================
-- Tables
-- ============================================================================

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (property_id, user_id)
);

create index memberships_user_id_idx on public.memberships(user_id);

create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  stream_channel_id text not null,
  stream_channel_type text not null default 'team',
  name text not null,
  is_private boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (property_id, stream_channel_id)
);

create index chat_channels_property_id_idx on public.chat_channels(property_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_property_id_idx on public.tasks(property_id);
create index tasks_assignee_id_idx on public.tasks(assignee_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','manager','staff')),
  token text unique not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index invites_email_idx on public.invites(email);

-- ============================================================================
-- Triggers
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RLS helper
-- ============================================================================

create or replace function public.is_member(prop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where property_id = prop_id and user_id = auth.uid()
  );
$$;

-- ============================================================================
-- RLS policies
-- ============================================================================

alter table public.properties enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.chat_channels enable row level security;
alter table public.tasks enable row level security;
alter table public.invites enable row level security;

-- properties: members can read; any authenticated user can insert (becomes owner via app code).
create policy "properties_select_member" on public.properties
  for select using (public.is_member(id));

create policy "properties_insert_authenticated" on public.properties
  for insert with check (auth.uid() is not null);

create policy "properties_update_owner_manager" on public.properties
  for update using (
    exists (
      select 1 from public.memberships
      where property_id = properties.id
        and user_id = auth.uid()
        and role in ('owner','manager')
    )
  );

-- profiles: a user can read their own row, plus rows of users sharing any property.
create policy "profiles_select_self_or_shared_property" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships m1
      join public.memberships m2 on m1.property_id = m2.property_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid());

-- memberships: a user can see memberships for their own properties.
create policy "memberships_select_member" on public.memberships
  for select using (public.is_member(property_id));

-- Inserting memberships happens server-side (service role) during onboarding/invite accept.
-- No public insert policy on memberships intentionally.

-- chat_channels: scoped to membership.
create policy "chat_channels_select_member" on public.chat_channels
  for select using (public.is_member(property_id));

create policy "chat_channels_insert_member" on public.chat_channels
  for insert with check (public.is_member(property_id));

create policy "chat_channels_update_member" on public.chat_channels
  for update using (public.is_member(property_id));

create policy "chat_channels_delete_member" on public.chat_channels
  for delete using (public.is_member(property_id));

-- tasks: scoped to membership.
create policy "tasks_select_member" on public.tasks
  for select using (public.is_member(property_id));

create policy "tasks_insert_member" on public.tasks
  for insert with check (public.is_member(property_id));

create policy "tasks_update_member" on public.tasks
  for update using (public.is_member(property_id));

create policy "tasks_delete_member" on public.tasks
  for delete using (public.is_member(property_id));

-- invites: only managers/owners of the property can read/manage.
create policy "invites_select_owner_manager" on public.invites
  for select using (
    exists (
      select 1 from public.memberships
      where property_id = invites.property_id
        and user_id = auth.uid()
        and role in ('owner','manager')
    )
  );

create policy "invites_insert_owner_manager" on public.invites
  for insert with check (
    exists (
      select 1 from public.memberships
      where property_id = invites.property_id
        and user_id = auth.uid()
        and role in ('owner','manager')
    )
  );
