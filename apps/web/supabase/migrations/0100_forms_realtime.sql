-- Publish `forms` and `form_responses` to Supabase Realtime.
--
-- Forms became a first-class rail section (2026-08-11): the section sidebar
-- (components/shell/sections/forms-section.tsx) lists every form with a live
-- response count, so creating/renaming/publishing a form or receiving a
-- submission in one session must push to every other open session. RLS on
-- both tables already scopes reads to property members, and Realtime respects
-- RLS for postgres_changes.
--
-- Idempotent: skip each table if it's already a member of the publication.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'forms'
  ) then
    alter publication supabase_realtime add table public.forms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'form_responses'
  ) then
    alter publication supabase_realtime add table public.form_responses;
  end if;
end $$;
