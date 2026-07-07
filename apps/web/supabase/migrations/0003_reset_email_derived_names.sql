-- One-time cleanup. Migration 0001's trigger fell back to the email's
-- local-part when no provider metadata supplied a name (e.g. "oamarkanji"
-- for "oamarkanji@icloud.com"). Migration 0002 then bulk-marked all profiles
-- as onboarded, which means those users never got prompted to set a real
-- name and the auto-derived string still shows up in chat / DM lists.
--
-- This migration resets `onboarded_at` for any profile whose `full_name`
-- exactly matches the local-part of the user's email — strong signal it
-- was auto-derived rather than user-chosen. They'll be sent through
-- /welcome on next sign-in.

update public.profiles p
set onboarded_at = null
from auth.users u
where p.id = u.id
  and p.onboarded_at is not null
  and p.full_name is not null
  and p.full_name = split_part(u.email, '@', 1);
