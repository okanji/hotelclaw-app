-- Per-user display preference for clock format. '24h' matches the prior
-- hardcoded behaviour, so existing rows keep their current rendering and no
-- backfill is needed.
alter table public.profiles
  add column if not exists time_format text not null default '24h'
    check (time_format in ('12h', '24h'));
