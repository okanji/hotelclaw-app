-- Meetings could never be deleted by a user.
--
-- 0016 shipped select / insert / update policies for `meetings` but no delete
-- policy, so RLS denied every delete. Postgres reports that as zero rows
-- affected rather than an error, so `deleteMeeting` returned `{ ok: true }`
-- while the row survived — the web "Delete event" button has been silently
-- doing nothing. Found while adding the mobile calendar's cancel action.
--
-- Mirrors `meetings_update_member` exactly: any member of the property may
-- delete, the same set that can already rewrite a meeting's title, time, and
-- attendees. Narrowing delete to the host would be a different (defensible)
-- policy, but it would not match the permission model the rest of the table
-- already uses.
--
-- meeting_attendees / transcripts reference meetings with `on delete cascade`,
-- so no orphan cleanup is needed here.

create policy "meetings_delete_member" on public.meetings
  for delete using (public.is_member(property_id));
