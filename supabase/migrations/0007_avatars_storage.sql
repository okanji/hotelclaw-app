-- Avatars storage bucket. Public so <img src> works without signed URLs (the
-- existing avatar_url column already holds OAuth-provider URLs, so consistent).
-- Files live under `<user_id>/<filename>` and RLS scopes write access to the
-- owner of that folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024, -- 2 MiB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Reads: anyone (the bucket is public; RLS still needs a SELECT policy so
-- upserts work and the dashboard can list objects).
create policy "avatars_select_all"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

-- Writes: a user can only manage files in their own `<user_id>/` folder.
-- storage.foldername(name) splits the object key by '/', so [1] is the
-- top-level folder.
create policy "avatars_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
