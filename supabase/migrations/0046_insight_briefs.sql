-- Automatic intelligence briefs — the structured insight cards at the top of
-- the Insights page. One row per property (latest only; history lives in
-- insight_reports). `fingerprint` is a hash of the metrics the brief was
-- written from: the brief route regenerates only when it changes, so the
-- model runs exactly as often as the numbers actually move.

create table public.insight_briefs (
  property_id uuid primary key references public.properties(id) on delete cascade,
  insights jsonb not null,
  fingerprint text not null,
  model text not null,
  generated_at timestamptz not null default now()
);

alter table public.insight_briefs enable row level security;

-- Briefs narrate management aggregates (workload, risk) — owner/manager only.
create policy insight_briefs_select on public.insight_briefs
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = insight_briefs.property_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  );

-- Writes via the service-role client only.

-- Publish so a fresh brief pushes to open Insights pages (stale-while-
-- revalidate: the page shows the old brief, the background regeneration
-- lands, realtime swaps it in).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'insight_briefs'
  ) then
    alter publication supabase_realtime add table public.insight_briefs;
  end if;
end $$;
