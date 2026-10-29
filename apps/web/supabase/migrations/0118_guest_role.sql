-- 0118 — Guest role scoped to teams / lists / tasks / docs / channels
-- (ClickUp parity, Phase 5).
--
-- Temple Point invites contractors (jambotask.com), agencies
-- (kaleidoscope.wtf) and wedding couples into ClickUp as GUESTS who see only
-- what was shared with them. Until now every membership saw the whole
-- property.
--
-- G3 — the inversion that keeps this safe: `is_member(prop)` now means FULL
-- member (owner / manager / staff). Every existing policy (~218) that says
-- `is_member` therefore DENIES guests with zero edits and fails closed — a
-- policy nobody remembered to touch hides data rather than leaking it.
-- `has_property_access(prop)` keeps the old "any membership row" meaning for
-- the handful of entry tables a guest must read (the property, the member
-- directory, labels, statuses, their own prefs). The tables a guest reaches
-- through a grant get hand-written policies below: full members pass on the
-- same `is_member` fast path as before; guests pass through
-- `can_access_*` helpers over `member_scopes`.
--
-- Grant inheritance is ClickUp's: a space grant covers its sub-spaces, its
-- lists, their tasks, its documents and its channels; a list grant covers its
-- tasks; a task grant covers the task and its direct sub-issues.
--
-- Invisible on apply: no guest membership can exist before this migration
-- (the role CHECK forbade it), so every current user is a full member and
-- every rewritten policy evaluates exactly as before for them.

-- ── Roles ───────────────────────────────────────────────────────────────────

alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner', 'manager', 'staff', 'guest'));

alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check
  check (role in ('owner', 'manager', 'staff', 'guest'));

alter table public.invites add column scopes jsonb not null default '[]'::jsonb;
comment on column public.invites.scopes is
  'Guest invites (0118): [{kind: space|list|task|document|channel, id, can_edit}] applied to member_scopes on accept.';

-- ── Grants ──────────────────────────────────────────────────────────────────

create table public.member_scopes (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  user_id     uuid not null,
  scope_kind  text not null check (scope_kind in ('space', 'list', 'task', 'document', 'channel')),
  scope_id    uuid not null,
  can_edit    boolean not null default false,
  granted_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (property_id, user_id, scope_kind, scope_id),
  foreign key (property_id, user_id)
    references public.memberships (property_id, user_id) on delete cascade
);

create index member_scopes_user_idx
  on public.member_scopes (user_id, property_id, scope_kind, scope_id);
create index member_scopes_target_idx on public.member_scopes (scope_kind, scope_id);

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.member_role(prop_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.memberships
   where property_id = prop_id and user_id = (select auth.uid());
$$;

-- The OLD meaning of is_member: any membership row, guests included.
create or replace function public.has_property_access(prop_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships
     where property_id = prop_id and user_id = (select auth.uid())
  );
$$;

-- G3: FULL member. Guests are not members for any policy that says so.
create or replace function public.is_member(prop_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships
     where property_id = prop_id and user_id = (select auth.uid())
       and role in ('owner', 'manager', 'staff')
  );
$$;

create or replace function public.is_management(prop_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships
     where property_id = prop_id and user_id = (select auth.uid())
       and role in ('owner', 'manager')
  );
$$;

create or replace function public.has_scope(
  prop_id uuid, kind text, target uuid, need_edit boolean default false
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.member_scopes
     where property_id = prop_id and user_id = (select auth.uid())
       and scope_kind = kind and scope_id = target
       and (not need_edit or can_edit)
  );
$$;

create or replace function public.can_access_space(sid uuid, need_edit boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.spaces s
     where s.id = sid
       and (
         public.is_member(s.property_id)
         or public.has_scope(s.property_id, 'space', s.id, need_edit)
         or (s.parent_space_id is not null
             and public.has_scope(s.property_id, 'space', s.parent_space_id, need_edit))
       )
  );
$$;

create or replace function public.can_access_list(lid uuid, need_edit boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.lists l
     where l.id = lid
       and (
         public.is_member(l.property_id)
         or public.has_scope(l.property_id, 'list', l.id, need_edit)
         or (l.space_id is not null and public.can_access_space(l.space_id, need_edit))
       )
  );
$$;

-- The row-level form the tasks policies call with the row's own columns, so
-- no second read of `tasks` happens per row.
create or replace function public.task_in_scope(
  prop_id uuid, tid uuid, parent uuid, lid uuid, sid uuid, need_edit boolean default false
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_member(prop_id)
      or public.has_scope(prop_id, 'task', tid, need_edit)
      or (parent is not null and public.has_scope(prop_id, 'task', parent, need_edit))
      or (lid is not null and public.can_access_list(lid, need_edit))
      or (sid is not null and public.can_access_space(sid, need_edit));
$$;

create or replace function public.can_access_task(tid uuid, need_edit boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = tid
       and public.task_in_scope(t.property_id, t.id, t.parent_id, t.list_id, t.space_id, need_edit)
  );
$$;

create or replace function public.can_access_document(did uuid, need_edit boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.documents d
     where d.id = did
       and (
         public.is_member(d.property_id)
         or public.has_scope(d.property_id, 'document', d.id, need_edit)
         or (d.parent_id is not null
             and public.has_scope(d.property_id, 'document', d.parent_id, need_edit))
         or (d.space_id is not null and public.can_access_space(d.space_id, need_edit))
       )
  );
$$;

create or replace function public.can_access_channel(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.chat_channels c
     where c.id = cid
       and (
         public.is_member(c.property_id)
         or public.has_scope(c.property_id, 'channel', c.id, false)
         or (c.space_id is not null and public.can_access_space(c.space_id, false))
       )
  );
$$;

grant execute on function
  public.member_role(uuid), public.has_property_access(uuid), public.is_management(uuid),
  public.has_scope(uuid, text, uuid, boolean), public.can_access_space(uuid, boolean),
  public.can_access_list(uuid, boolean), public.task_in_scope(uuid, uuid, uuid, uuid, uuid, boolean),
  public.can_access_task(uuid, boolean), public.can_access_document(uuid, boolean),
  public.can_access_channel(uuid)
to authenticated;

-- ── member_scopes RLS ───────────────────────────────────────────────────────

alter table public.member_scopes enable row level security;

create policy "member_scopes select own or management" on public.member_scopes
  for select using (user_id = (select auth.uid()) or public.is_management(property_id));
-- Grants are only ever given to GUESTS — a full member already sees it all.
create policy "member_scopes write management" on public.member_scopes
  for all using (public.is_management(property_id))
  with check (
    public.is_management(property_id)
    and exists (select 1 from public.memberships m
                 where m.property_id = member_scopes.property_id
                   and m.user_id = member_scopes.user_id
                   and m.role = 'guest')
  );

alter table public.member_scopes replica identity full;
alter publication supabase_realtime add table public.member_scopes;

-- ── A-entry: any membership (guests included) ───────────────────────────────
-- Written as ALTER POLICY (+ new select policies where an ALL policy splits)
-- rather than drop / create: same end state, no destructive statements.

alter policy "properties_select_member" on public.properties
  using (public.has_property_access(id));

-- Accepted phase-1 leak: guests see the member directory (names on shared
-- tasks, assignee avatars, mentions).
alter policy "memberships_select_member" on public.memberships
  using (public.has_property_access(property_id));

-- labels_member (ALL, is_member) keeps writes for full members; guests read.
create policy "labels select access" on public.labels
  for select using (public.has_property_access(property_id));

alter policy "statuses select member" on public.statuses
  using (public.has_property_access(property_id));
alter policy "status_sets select member" on public.status_sets
  using (public.has_property_access(property_id));

alter policy "notification_prefs_own" on public.notification_prefs
  using (user_id = (select auth.uid()) and public.has_property_access(property_id))
  with check (user_id = (select auth.uid()) and public.has_property_access(property_id));

alter policy "task_view_columns_own" on public.task_view_columns
  using (user_id = (select auth.uid()) and public.has_property_access(property_id))
  with check (user_id = (select auth.uid()) and public.has_property_access(property_id));

alter policy "task_views_select" on public.task_views
  using (
    public.has_property_access(property_id)
    and (user_id = (select auth.uid()) or (shared and public.is_member(property_id)))
  );
-- Only full members publish shared views.
alter policy "task_views_insert" on public.task_views
  with check (
    public.has_property_access(property_id) and user_id = (select auth.uid())
    and (not shared or public.is_member(property_id))
  );

-- ── A-scoped: spaces / lists / channels / fields ────────────────────────────
-- The ALL policies (is_member) stay as the full-member write path; a select
-- policy adds the guest read path (permissive policies OR together).

create policy "spaces select scoped" on public.spaces
  for select using (public.can_access_space(id));
create policy "space_members select scoped" on public.space_members
  for select using (public.can_access_space(space_id));
create policy "space_labels select scoped" on public.space_labels
  for select using (public.can_access_space(space_id));
create policy "lists select scoped" on public.lists
  for select using (public.can_access_list(id));

alter policy "chat_channels_select_member" on public.chat_channels
  using (public.is_member(property_id) or public.can_access_channel(id));

alter policy "custom_fields_select_member" on public.custom_fields
  using (
    public.is_member(property_id)
    or (public.has_property_access(property_id)
        and (space_id is null or public.can_access_space(space_id))
        and (list_id is null or public.can_access_list(list_id)))
  );

-- ── A-scoped: tasks ─────────────────────────────────────────────────────────

alter policy "tasks_select_member" on public.tasks
  using (
    public.is_member(property_id)
    or public.task_in_scope(property_id, id, parent_id, list_id, space_id, false)
  );

alter policy "tasks_insert_member" on public.tasks
  with check (
    public.is_member(property_id)
    or (created_by = (select auth.uid())
        and public.task_in_scope(property_id, id, parent_id, list_id, space_id, true))
  );

-- USING picks the rows a guest may edit; WITH CHECK stops them moving a task
-- out of what they were granted.
alter policy "tasks_update_member" on public.tasks
  using (
    public.is_member(property_id)
    or public.task_in_scope(property_id, id, parent_id, list_id, space_id, true)
  )
  with check (
    public.is_member(property_id)
    or public.task_in_scope(property_id, id, parent_id, list_id, space_id, true)
  );
-- tasks_delete_member stays is_member: guests never delete.

-- Per-task child tables: read with access, write with EDIT access.
alter policy "task_links_member" on public.task_links
  using (public.can_access_task(task_id, true))
  with check (public.can_access_task(task_id, true));
create policy "task_links select scoped" on public.task_links
  for select using (public.can_access_task(task_id));

alter policy "task_relations_member" on public.task_relations
  using (public.can_access_task(task_id, true) and public.can_access_task(related_task_id))
  with check (
    public.can_access_task(task_id, true) and public.can_access_task(related_task_id)
    and exists (select 1 from public.tasks t join public.tasks rt on rt.id = task_relations.related_task_id
                 where t.id = task_relations.task_id and t.property_id = rt.property_id)
  );
create policy "task_relations select scoped" on public.task_relations
  for select using (public.can_access_task(task_id) and public.can_access_task(related_task_id));

alter policy "task_document_links_member" on public.task_document_links
  using (public.can_access_task(task_id, true))
  with check (public.can_access_task(task_id, true));
create policy "task_document_links select scoped" on public.task_document_links
  for select using (public.can_access_task(task_id));

alter policy "task_attachments_member" on public.task_attachments
  using (public.can_access_task(task_id, true))
  with check (public.can_access_task(task_id, true));
create policy "task_attachments select scoped" on public.task_attachments
  for select using (public.can_access_task(task_id));

alter policy "task_description_revisions_member" on public.task_description_revisions
  using (public.can_access_task(task_id));

alter policy "task_field_values_select_member" on public.task_field_values
  using (public.is_member(property_id) or public.can_access_task(task_id));
alter policy "task_field_values_insert_member" on public.task_field_values
  with check (public.is_member(property_id) or public.can_access_task(task_id, true));
alter policy "task_field_values_update_member" on public.task_field_values
  using (public.is_member(property_id) or public.can_access_task(task_id, true));
alter policy "task_field_values_delete_member" on public.task_field_values
  using (public.is_member(property_id) or public.can_access_task(task_id, true));

alter policy "task_assignees select member" on public.task_assignees
  using (public.is_member(property_id) or public.can_access_task(task_id));
alter policy "task_assignees insert member" on public.task_assignees
  with check (
    (public.is_member(property_id) or public.can_access_task(task_id, true))
    and exists (select 1 from public.tasks t
                 where t.id = task_id and t.property_id = task_assignees.property_id)
    and exists (select 1 from public.memberships m
                 where m.property_id = task_assignees.property_id
                   and m.user_id = task_assignees.user_id)
  );
alter policy "task_assignees update member" on public.task_assignees
  using (public.is_member(property_id) or public.can_access_task(task_id, true))
  with check (public.is_member(property_id) or public.can_access_task(task_id, true));
alter policy "task_assignees delete member" on public.task_assignees
  using (public.is_member(property_id) or public.can_access_task(task_id, true));

alter policy "task_checklists member" on public.task_checklists
  using (public.is_member(property_id) or public.can_access_task(task_id, true))
  with check (
    (public.is_member(property_id) or public.can_access_task(task_id, true))
    and exists (select 1 from public.tasks t
                 where t.id = task_id and t.property_id = task_checklists.property_id)
  );
create policy "task_checklists select scoped" on public.task_checklists
  for select using (public.can_access_task(task_id));

alter policy "task_checklist_items member" on public.task_checklist_items
  using (public.is_member(property_id) or public.can_access_task(task_id, true))
  with check (
    (public.is_member(property_id) or public.can_access_task(task_id, true))
    and exists (select 1 from public.task_checklists c
                 where c.id = checklist_id and c.task_id = task_checklist_items.task_id
                   and c.property_id = task_checklist_items.property_id)
  );
create policy "task_checklist_items select scoped" on public.task_checklist_items
  for select using (public.can_access_task(task_id));

-- ── A-scoped: documents ─────────────────────────────────────────────────────

alter policy "documents_select_member" on public.documents
  using (public.is_member(property_id) or public.can_access_document(id));
alter policy "documents_update_member" on public.documents
  using (public.is_member(property_id) or public.can_access_document(id, true));
-- documents_insert_member stays is_member: guests don't create docs (phase 1).

-- document_labels_member (ALL, is_member via the doc) keeps writes.
create policy "document_labels select scoped" on public.document_labels
  for select using (public.can_access_document(document_id));

-- ── activity ────────────────────────────────────────────────────────────────

alter policy "activity_log members read" on public.activity_log
  using (
    public.is_member(property_id)
    or (entity_kind = 'task' and public.can_access_task(entity_id))
  );

-- ── storage: task-attachments ({property}/{task}/{file}) ────────────────────

alter policy "task_attachments_select_member" on storage.objects
  using (
    bucket_id = 'task-attachments'
    and (
      public.is_member(((storage.foldername(name))[1])::uuid)
      or ((storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_task(((storage.foldername(name))[2])::uuid))
    )
  );
alter policy "task_attachments_insert_member" on storage.objects
  with check (
    bucket_id = 'task-attachments'
    and (
      public.is_member(((storage.foldername(name))[1])::uuid)
      or ((storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_task(((storage.foldername(name))[2])::uuid, true))
    )
  );
alter policy "task_attachments_delete_member" on storage.objects
  using (
    bucket_id = 'task-attachments'
    and (public.is_member(((storage.foldername(name))[1])::uuid) or owner = (select auth.uid()))
  );
