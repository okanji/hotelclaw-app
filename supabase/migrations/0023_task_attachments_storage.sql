-- Private bucket for task file attachments.
-- Path layout: `{property_id}/{task_id}/{uuid}-{filename}`.

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'task-attachments',
  'task-attachments',
  false,
  25 * 1024 * 1024
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create policy "task_attachments_select_member"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "task_attachments_insert_member"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "task_attachments_delete_member"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
