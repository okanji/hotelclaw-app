-- Invite pre-fill: let the inviter (or the onboarding wizard) optionally set a
-- new teammate's details up front. On accept, these seed the person's profile
-- name and their membership row (title/home-team/reports-to) so a freshly
-- invited user lands in the org already positioned — the invited-user
-- onboarding form pre-fills from these and the user can still edit.
--
--   * full_name        → profiles.full_name (only if the user hasn't set one)
--   * title            → memberships.title            (job title / position)
--   * primary_space_id → memberships.primary_space_id (home team)
--   * manager_id       → memberships.manager_id       (reports-to)
--
-- All optional; a blank invite behaves exactly as before.

alter table public.invites
  add column if not exists full_name text,
  add column if not exists title text,
  add column if not exists primary_space_id uuid
    references public.spaces(id) on delete set null,
  add column if not exists manager_id uuid
    references auth.users(id) on delete set null;
