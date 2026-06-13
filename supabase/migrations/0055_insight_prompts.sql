-- Pinned insight prompts — a user pins a recurring question ("anything
-- blocking tomorrow's banquet?") to their Insights page, bound to a lens.
-- The Q&A bot answers it; the answer is fingerprint-cached against the
-- lens's metrics, so a pinned card re-generates only when the numbers it
-- reads actually move (page-visit SWR, not a polling timer).

create table public.insight_prompts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  -- scopeKey wire format: 'property' | 'project:<id>' | 'space:<id>' | 'person:<id>'
  scope text not null default 'property',
  answer_md text,
  fingerprint text,
  generated_at timestamptz,
  created_at timestamptz not null default now()
);

create index insight_prompts_user_idx
  on public.insight_prompts (property_id, user_id, created_at);

alter table public.insight_prompts enable row level security;

-- Prompts are personal: each member manages their own. Answers are written
-- by the service-role generator.
create policy insight_prompts_own on public.insight_prompts
  for all using (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.property_id = insight_prompts.property_id
        and m.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.property_id = insight_prompts.property_id
        and m.user_id = auth.uid()
    )
  );
