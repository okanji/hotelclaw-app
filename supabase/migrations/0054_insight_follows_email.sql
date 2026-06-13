-- Email digests + threshold alerts: per-user follows of an insights lens
-- (daily/weekly email of the already-cached brief/report), user-defined
-- alert rules evaluated edge-triggered by the refresh-briefs cron, global
-- per-user email preferences with a tokenized unsubscribe, and a send log
-- that makes cron retries idempotent.

create table public.email_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  digests_enabled boolean not null default true,
  alerts_enabled boolean not null default true,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_prefs enable row level security;
create policy email_prefs_own on public.email_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.insight_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- scopeKey wire format: 'property' | 'project:<id>' | 'space:<id>' | 'person:<id>'
  scope text not null,
  cadence text not null check (cadence in ('daily','weekly')),
  created_at timestamptz not null default now(),
  unique (user_id, property_id, scope)
);

create index insight_follows_property_idx on public.insight_follows (property_id);
create index insight_follows_user_idx on public.insight_follows (user_id);

alter table public.insight_follows enable row level security;
create policy insight_follows_own on public.insight_follows
  for all using (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.property_id = insight_follows.property_id
        and m.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.property_id = insight_follows.property_id
        and m.user_id = auth.uid()
    )
  );

create table public.insight_alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  scope text not null,
  metric text not null check (metric in
    ('overdue_count','blocked_count','unassigned_urgent_count','project_at_risk')),
  threshold int,
  enabled boolean not null default true,
  -- { firing: bool, value: number, at: iso } — edge-trigger memory.
  last_state jsonb not null default '{}',
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, property_id, scope, metric)
);

create index insight_alert_rules_property_idx
  on public.insight_alert_rules (property_id) where enabled;

alter table public.insight_alert_rules enable row level security;
create policy insight_alert_rules_own on public.insight_alert_rules
  for all using (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.property_id = insight_alert_rules.property_id
        and m.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.property_id = insight_alert_rules.property_id
        and m.user_id = auth.uid()
    )
  );

create table public.insight_email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('digest_daily','digest_weekly','alert')),
  dedupe_key text not null,
  resend_id text,
  sent_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

-- Cron bookkeeping; service-role only.
alter table public.insight_email_log enable row level security;
