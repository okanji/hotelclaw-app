-- Intake triage — the trust-ladder pattern: the bot suggests routing fields
-- (space / assignee / priority) for bare new tasks with visible reasoning;
-- humans accept or dismiss (recorded, so acceptance rates are inspectable);
-- owners can graduate individual fields to auto-apply, which still writes a
-- suggestion row (status 'auto_applied') so the provenance stays visible.

create table public.task_suggestions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  field text not null check (field in ('space','assignee','priority')),
  -- space id / user id / priority value; validated against real candidates
  -- before insert — never a free-text model value.
  suggested_value text not null,
  display_value text not null,
  reasoning text not null,
  confidence text not null check (confidence in ('low','medium','high')),
  status text not null default 'pending'
    check (status in ('pending','accepted','dismissed','auto_applied')),
  model text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  unique (task_id, field)
);

create index task_suggestions_task_idx on public.task_suggestions (task_id);
create index task_suggestions_property_idx
  on public.task_suggestions (property_id, created_at desc);

alter table public.task_suggestions enable row level security;

-- Members read suggestions on their property's tasks; writes go through the
-- service-role client (generator + the accept/dismiss route).
create policy task_suggestions_select on public.task_suggestions
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = task_suggestions.property_id
        and m.user_id = auth.uid()
    )
  );

-- Per-property autonomy dial. One row per property; absent row = all off.
create table public.triage_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  -- { space: bool, assignee: bool, priority: bool }
  auto_apply jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.triage_settings enable row level security;

create policy triage_settings_select on public.triage_settings
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = triage_settings.property_id
        and m.user_id = auth.uid()
    )
  );
-- Writes via the owner-gated route's service client.
