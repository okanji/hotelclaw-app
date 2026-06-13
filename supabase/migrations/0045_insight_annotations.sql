-- One-line AI assessments on flagged subjects (today: at-risk portfolio
-- projects; the kind column leaves room for spaces/people later). Generated
-- by a Haiku-tier pass in the insights bot and cached: `cache_key` encodes
-- the subject's updated_at, so a project that hasn't changed never pays for
-- a second generation.

create table public.insight_annotations (
  property_id uuid not null references public.properties(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('project')),
  subject_id uuid not null,
  cache_key text not null,
  note text not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (property_id, subject_kind, subject_id)
);

alter table public.insight_annotations enable row level security;

-- Annotations narrate management aggregates (risk, workload), so they follow
-- the management-report visibility rule rather than plain membership.
create policy insight_annotations_select on public.insight_annotations
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = insight_annotations.property_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  );

-- Writes via the service-role client only.
