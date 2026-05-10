-- Profile onboarding: track whether a user has completed the "set your name"
-- step. NULL = needs welcome page; non-NULL = good to go.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- Existing profiles have already been using the app; treat them as onboarded
-- so we don't suddenly prompt established users.
update public.profiles
  set onboarded_at = now()
  where onboarded_at is null;

-- Update the auto-create trigger so new users start with NULL full_name
-- when no provider metadata gives us a real name (vs. the previous fallback
-- to the email's local-part, which is ugly and forces a manual edit later).
-- OAuth signups (Google etc.) that include a `full_name` or `name` in
-- user_metadata are auto-onboarded with that name; everyone else lands at
-- /welcome.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    ''
  );
begin
  insert into public.profiles (id, full_name, avatar_url, onboarded_at)
  values (
    new.id,
    v_name,
    new.raw_user_meta_data->>'avatar_url',
    case when v_name is not null then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
