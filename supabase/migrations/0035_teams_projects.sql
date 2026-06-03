-- Teams + Projects.
--
-- Teams are departments within a property (F&B, Maintenance). Projects are
-- cross-team initiatives (Festival, Wedding) that can span multiple teams.
-- Both are ORGANIZATIONAL groupings, not security boundaries: every property
-- member can see every team and project, so RLS stays at property-membership
-- level (`is_member`). Team-private content, if ever wanted, is an additive
-- change later. Tasks and documents each gain an optional team_id + project_id.

-- ── Teams ────────────────────────────────────────────────────────────────────
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  color text not null default 'slate'
    check (color in ('slate','blue','green','amber','rose','violet')),
  icon text,
  position double precision not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index teams_property_id_idx on public.teams (property_id);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_id_idx on public.team_members (user_id);

-- ── Projects ─────────────────────────────────────────────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text,
  color text not null default 'blue'
    check (color in ('slate','blue','green','amber','rose','violet')),
  icon text,
  status text not null default 'active'
    check (status in ('active','planned','completed','archived')),
  start_date date,
  target_date date,
  position double precision not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_property_id_idx on public.projects (property_id);

-- A project spans many teams; a team can belong to many projects.
create table public.project_teams (
  project_id uuid not null references public.projects(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, team_id)
);
create index project_teams_team_id_idx on public.project_teams (team_id);

-- ── Tag tasks + documents with an optional team and project ─────────────────
alter table public.tasks
  add column team_id uuid references public.teams(id) on delete set null,
  add column project_id uuid references public.projects(id) on delete set null;
create index tasks_team_id_idx on public.tasks (team_id);
create index tasks_project_id_idx on public.tasks (project_id);

alter table public.documents
  add column team_id uuid references public.teams(id) on delete set null,
  add column project_id uuid references public.projects(id) on delete set null;
create index documents_team_id_idx on public.documents (team_id);
create index documents_project_id_idx on public.documents (project_id);

-- ── RLS: property-member access (organizational, not a security boundary) ────
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_teams enable row level security;

create policy "teams_member" on public.teams
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy "projects_member" on public.projects
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy "team_members_member" on public.team_members
  for all using (
    exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and public.is_member(t.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and public.is_member(t.property_id)
    )
  );

create policy "project_teams_member" on public.project_teams
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = project_teams.project_id and public.is_member(p.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_teams.project_id and public.is_member(p.property_id)
    )
  );

-- Live updates for the Home sidebar's Teams + Projects lists.
alter publication supabase_realtime add table public.teams;
alter publication supabase_realtime add table public.projects;
