-- Rename Teams → Spaces.
--
-- After comparing ClickUp / Linear / Asana, "Team" is really the ClickUp
-- "Space": the primary department container (F&B, Maintenance) that tasks,
-- docs, members, and channels live in. Projects stay as the cross-Space
-- initiative layer (Wedding/Festival). This is a pure rename — no data moves.
--
-- Table renames carry their RLS policies, indexes, FKs, and realtime-publication
-- membership automatically (catalog references are by OID/attnum, not by name),
-- so policy bodies that reference the renamed table/column keep working. We
-- rename the indexes + policies too, purely for legibility.

alter table public.teams rename to spaces;
alter table public.team_members rename to space_members;
alter table public.project_teams rename to project_spaces;

alter table public.project_spaces rename column team_id to space_id;
alter table public.tasks rename column team_id to space_id;
alter table public.documents rename column team_id to space_id;

-- Indexes (legibility only).
alter index if exists teams_property_id_idx rename to spaces_property_id_idx;
alter index if exists team_members_user_id_idx rename to space_members_user_id_idx;
alter index if exists project_teams_team_id_idx rename to project_spaces_space_id_idx;
alter index if exists tasks_team_id_idx rename to tasks_space_id_idx;
alter index if exists documents_team_id_idx rename to documents_space_id_idx;

-- Policies (legibility only — bodies already re-resolved to the new names).
alter policy "teams_member" on public.spaces rename to "spaces_member";
alter policy "team_members_member" on public.space_members rename to "space_members_member";
alter policy "project_teams_member" on public.project_spaces rename to "project_spaces_member";
