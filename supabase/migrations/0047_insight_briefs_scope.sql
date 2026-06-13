-- Scoped intelligence briefs: the Insights page can be re-lensed to a
-- project / space (team) / person, and each lens caches its own brief.
-- `scope` is the wire format from lib/insights/scope.ts:
--   'property' | 'project:<uuid>' | 'space:<uuid>' | 'person:<uuid>'

alter table public.insight_briefs
  add column scope text not null default 'property';

alter table public.insight_briefs
  drop constraint insight_briefs_pkey;

alter table public.insight_briefs
  add primary key (property_id, scope);
