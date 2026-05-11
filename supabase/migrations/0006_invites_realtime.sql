-- Realtime + invitee read access for the invites table.
--
-- The original RLS only allowed owners/managers of a property to read its
-- invites. That's why /api/me/pending-invites uses the service-role client
-- to read the recipient's own invite. To deliver Realtime events to the
-- invited user we need them to be able to SELECT their row under RLS —
-- otherwise Supabase Realtime filters the event out before push.
--
-- Emails are stored lowercased on insert (see lib/invites/actions.ts), so
-- comparison can rely on byte-equality if we lower the JWT side too.

create policy "invites_select_invitee" on public.invites
  for select to authenticated using (
    lower(email) = lower(auth.jwt() ->> 'email')
  );

alter publication supabase_realtime add table public.invites;
