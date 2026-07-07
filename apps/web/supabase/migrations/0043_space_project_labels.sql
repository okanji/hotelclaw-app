-- Space descriptions + project/space label junctions.
--
-- Labels are already a property-wide catalog (0036_labels) shared by tasks
-- (text[]) and documents (document_labels). Projects and spaces get the same
-- junction pattern so one label can tag an issue, doc, project, or space.

alter table public.spaces
  add column description text;

create table public.project_labels (
  project_id uuid not null references public.projects(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, label_id)
);
create index project_labels_label_id_idx
  on public.project_labels (label_id);

create table public.space_labels (
  space_id uuid not null references public.spaces(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (space_id, label_id)
);
create index space_labels_label_id_idx
  on public.space_labels (label_id);

alter table public.project_labels enable row level security;
alter table public.space_labels enable row level security;

create policy "project_labels_member" on public.project_labels
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = project_labels.project_id and public.is_member(p.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_labels.project_id and public.is_member(p.property_id)
    )
  );

create policy "space_labels_member" on public.space_labels
  for all using (
    exists (
      select 1 from public.spaces s
      where s.id = space_labels.space_id and public.is_member(s.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = space_labels.space_id and public.is_member(s.property_id)
    )
  );

alter publication supabase_realtime add table public.project_labels;
alter publication supabase_realtime add table public.space_labels;
