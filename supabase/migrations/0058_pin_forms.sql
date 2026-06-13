-- Let spaces pin forms alongside documents. The (space_id, document_id) PK
-- assumed docs were the only pinnable kind; switch to a surrogate id with a
-- check that exactly one resource column is set, plus partial unique indexes
-- so a given doc/form can be pinned once per space. RLS policies are
-- unchanged — they only reference space_id.

alter table public.space_pinned_resources
  add column id uuid not null default gen_random_uuid();

alter table public.space_pinned_resources
  drop constraint space_pinned_resources_pkey;

alter table public.space_pinned_resources
  add primary key (id);

alter table public.space_pinned_resources
  alter column document_id drop not null;

alter table public.space_pinned_resources
  add column form_id uuid references public.forms(id) on delete cascade;

alter table public.space_pinned_resources
  add constraint space_pinned_resources_one_kind
  check ((document_id is null) <> (form_id is null));

create unique index space_pinned_resources_doc_unique
  on public.space_pinned_resources (space_id, document_id)
  where document_id is not null;

create unique index space_pinned_resources_form_unique
  on public.space_pinned_resources (space_id, form_id)
  where form_id is not null;
