-- 0120 — Favorites for everything you can star (gr8r-studio's Favorites page,
-- widened to this app's surfaces). Per user, per property, server-side, so a
-- star follows you across devices. Tasks keep their own `task_favorites`
-- (0022 — the task star, mobile, realtime 0119); this table covers the rest:
--   project · space (team) · document · form · channel (Stream channel id).
-- Documents used to be "pinned" in localStorage per device; the client
-- imports those pins into this table once.
--
-- `entity_id` is text (channel ids are Stream strings, the rest uuids) with no
-- FK: a favorite whose entity is gone is simply never shown (readers join
-- against what the viewer can already see, so RLS on the entity still fences
-- it), and a hard delete never has to know about favorites.

create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('project', 'space', 'document', 'form', 'channel')),
  entity_id text not null check (char_length(entity_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, entity_id)
);

create index if not exists favorites_user_property_idx
  on public.favorites (user_id, property_id, created_at desc);

alter table public.favorites enable row level security;

-- Your own stars only, in a property you belong to (any role — a guest may
-- star the docs and channels shared with them; what they can SEE is still
-- each entity's own RLS).
drop policy if exists "favorites_own" on public.favorites;
create policy "favorites_own" on public.favorites
  for all
  using (user_id = auth.uid() and public.has_property_access(property_id))
  with check (user_id = auth.uid() and public.has_property_access(property_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'favorites'
  ) then
    alter publication supabase_realtime add table public.favorites;
  end if;
end $$;
