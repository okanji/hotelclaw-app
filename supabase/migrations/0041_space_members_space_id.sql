-- 0041: finish the teams → spaces rename.
--
-- Migration 0038 renamed team_id → space_id on project_spaces, tasks, and
-- documents, but MISSED public.space_members — that column was left as
-- team_id. Every caller in the app reads/writes space_members.space_id
-- (lib/query/project-queries.ts `spaceMemberIdsQueryOptions`,
-- components/spaces/actions.ts `addSpaceMember` / `removeSpaceMember`), so
-- listing or editing a space's members has been erroring at runtime
-- (column "space_id" does not exist). Pure rename — no data moves.

alter table public.space_members rename column team_id to space_id;
