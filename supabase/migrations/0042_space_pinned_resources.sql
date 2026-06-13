-- Pinned resources on a space overview — a curated subset of documents.
-- Full membership still lives on documents.space_id; the Docs tab lists all
-- space docs while Overview shows only pins from this table.

create table public.space_pinned_resources (
  space_id uuid not null references public.spaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  position double precision not null,
  created_at timestamptz not null default now(),
  primary key (space_id, document_id)
);

create index space_pinned_resources_space_position_idx
  on public.space_pinned_resources (space_id, position);

alter table public.space_pinned_resources enable row level security;

create policy "space_pinned_resources_select_member" on public.space_pinned_resources
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = space_id and public.is_member(s.property_id)
    )
  );
create policy "space_pinned_resources_insert_member" on public.space_pinned_resources
  for insert with check (
    exists (
      select 1 from public.spaces s
      where s.id = space_id and public.is_member(s.property_id)
    )
  );
create policy "space_pinned_resources_update_member" on public.space_pinned_resources
  for update using (
    exists (
      select 1 from public.spaces s
      where s.id = space_id and public.is_member(s.property_id)
    )
  );
create policy "space_pinned_resources_delete_member" on public.space_pinned_resources
  for delete using (
    exists (
      select 1 from public.spaces s
      where s.id = space_id and public.is_member(s.property_id)
    )
  );
