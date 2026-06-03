-- Unified label catalog.
--
-- Labels were per-task free-text in `tasks.labels text[]` (migration 0022) with
-- no colors and no way to share them with documents. This adds a real catalog —
-- `labels` (name + color, per property) — and a `document_labels` junction so
-- the SAME label can tag a task and a document (the Linear-style cross-link).
--
-- The task side is deliberately left as-is: `tasks.labels` stays the store for
-- task↔label, so the existing task UI and the `task.label_added` workflow
-- trigger (which diffs the array) keep working untouched. The catalog mirrors
-- the task vocabulary; `addTaskLabel` upserts a catalog row so colors apply and
-- documents can reuse the same labels.

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  color text not null default 'slate'
    check (color in ('slate','blue','green','amber','rose','violet')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Case-insensitive uniqueness per property — "Urgent" and "urgent" are one label.
create unique index labels_property_name_idx
  on public.labels (property_id, lower(name));

create table public.document_labels (
  document_id uuid not null references public.documents(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (document_id, label_id)
);
create index document_labels_label_id_idx
  on public.document_labels (label_id);

-- Seed the catalog from existing task label strings — one row per distinct name
-- per property. The task array is unchanged; the catalog now carries the same
-- vocabulary so documents can share it (and colors can be assigned).
insert into public.labels (property_id, name)
select distinct t.property_id, trim(l)
from public.tasks t, unnest(t.labels) as l
where l is not null and length(trim(l)) > 0
on conflict (property_id, lower(name)) do nothing;

alter table public.labels enable row level security;
alter table public.document_labels enable row level security;

create policy "labels_member" on public.labels
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy "document_labels_member" on public.document_labels
  for all using (
    exists (
      select 1 from public.documents d
      where d.id = document_labels.document_id and public.is_member(d.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_labels.document_id and public.is_member(d.property_id)
    )
  );

alter publication supabase_realtime add table public.labels;
alter publication supabase_realtime add table public.document_labels;
