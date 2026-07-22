-- D1 — HR change proposals: staff/managers propose an org change ("we hired
-- a new head of housekeeping"), an owner approves, and the org chart applies
-- it — with role-based workflow refs ({{org.title.*}}/{{org.lead.*}}) every
-- downstream reference follows automatically. Direct owner/manager edits in
-- the org editor stay untouched; this is the second path.

create table public.org_change_proposals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('set_title', 'set_manager', 'set_home_team', 'set_team_lead')),
  -- set_title / set_manager / set_home_team → the person being changed;
  -- set_team_lead → null (subject is the team).
  subject_user_id uuid references auth.users(id) on delete cascade,
  -- set_team_lead / set_home_team → the team involved.
  subject_space_id uuid references public.spaces(id) on delete cascade,
  -- The proposed value: new title text, or the new manager/lead/team id.
  new_text text check (char_length(new_text) <= 80),
  new_id uuid,
  note text check (char_length(note) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz
);

create index org_change_proposals_property_idx
  on public.org_change_proposals (property_id, status, created_at desc);

alter table public.org_change_proposals enable row level security;

-- Any member can read + propose; decisions go through the owner-gated server
-- action (service-client write after the role check — the org-chart pattern).
create policy "org_proposals_select_member" on public.org_change_proposals
  for select using (public.is_member(property_id));
create policy "org_proposals_insert_member" on public.org_change_proposals
  for insert with check (public.is_member(property_id));
