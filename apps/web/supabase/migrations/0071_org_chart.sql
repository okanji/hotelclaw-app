-- Org chart: the company hierarchy, built on teams (the `spaces` table — the
-- product now calls them Teams; identifiers stay `space_*`).
--
--   * Teams nest:   spaces.parent_space_id     (F&B → Restaurant, Bar…)
--   * Teams lead:   spaces.lead_user_id        (who runs the team)
--   * People:       memberships.title          (job title at this property)
--                   memberships.manager_id     (reports-to, within property)
--                   memberships.primary_space_id (their home team — task
--                                               creation defaults to it)
--
-- The chart is deterministic data for BOTH surfaces: the /org editor and the
-- AI layer (`get_org_chart` tool renders it as text for every bot).

alter table public.spaces
  add column if not exists parent_space_id uuid references public.spaces(id) on delete set null,
  add column if not exists lead_user_id uuid references auth.users(id) on delete set null;

alter table public.memberships
  add column if not exists title text,
  add column if not exists manager_id uuid references auth.users(id) on delete set null,
  add column if not exists primary_space_id uuid references public.spaces(id) on delete set null;

create index if not exists spaces_parent_space_id_idx
  on public.spaces(parent_space_id);
create index if not exists memberships_manager_id_idx
  on public.memberships(manager_id);
