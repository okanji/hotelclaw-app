-- 0121 — Project files (gr8r-studio's project Files tab: Upload + dropzone).
-- Files uploaded straight onto a project, not onto one of its tasks (task
-- attachments keep `task_attachments` / the `task-attachments` bucket and
-- still show in the Files tab beside these).
--
-- Bucket `project-files` (private), path `{property_id}/{project_id}/{uuid}-{name}`.
-- Projects are full-member only (0118 left `projects` guest-denied), so both
-- the rows and the objects gate on `is_member` — guests fail closed.

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 300),
  storage_path text not null unique,
  byte_size bigint,
  mime_type text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_files_project_idx
  on public.project_files (project_id, created_at desc);

alter table public.project_files enable row level security;

drop policy if exists "project_files_select_member" on public.project_files;
create policy "project_files_select_member" on public.project_files
  for select using (public.is_member(property_id));

-- Insert: a member, as themselves, onto a project of the same property.
drop policy if exists "project_files_insert_member" on public.project_files;
create policy "project_files_insert_member" on public.project_files
  for insert with check (
    public.is_member(property_id)
    and created_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.property_id = project_files.property_id
    )
  );

-- Delete: whoever uploaded it, or an owner / manager.
drop policy if exists "project_files_delete_own_or_management" on public.project_files;
create policy "project_files_delete_own_or_management" on public.project_files
  for delete using (
    public.is_member(property_id)
    and (created_by = auth.uid() or public.is_management(property_id))
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_files'
  ) then
    alter publication supabase_realtime add table public.project_files;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 50 * 1024 * 1024)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "project_files_obj_select_member" on storage.objects;
create policy "project_files_obj_select_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-files'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "project_files_obj_insert_member" on storage.objects;
create policy "project_files_obj_insert_member"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "project_files_obj_delete_member" on storage.objects;
create policy "project_files_obj_delete_member"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-files'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
