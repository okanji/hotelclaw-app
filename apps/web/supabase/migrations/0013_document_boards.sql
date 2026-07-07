-- Document Boards — team-shared, per-property collections of pinned docs.
--
-- The docs home page shows boards above the all-docs list. Each board is a
-- horizontal strip of doc cards; users drag docs from the list onto a board
-- to pin them. A doc lives on at most one board (sticky-note model), enforced
-- by the unique index below. Boards are team-shared, not per-user — when the
-- GM pins "Today's VIPs" every front-desk agent on the property sees it.

create table public.document_boards (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null default 'New board',
  -- Display color accent. App-side `BOARD_COLORS` constant keeps this
  -- constrained; the CHECK keeps bad rows out at the DB level too.
  color text not null default 'slate',
  -- Sparse-float ordering between boards within a property (same scheme as
  -- tasks/docs: drop between two, take their midpoint, no renumbering).
  position double precision not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_boards_color_check
    check (color in ('slate','blue','green','amber','rose','violet'))
);

-- Reuse the trigger function from 0001_init.sql.
create trigger document_boards_set_updated_at
  before update on public.document_boards
  for each row execute function public.set_updated_at();

create index document_boards_property_position_idx
  on public.document_boards (property_id, position);

alter table public.document_boards enable row level security;

create policy "document_boards_select_member" on public.document_boards
  for select using (public.is_member(property_id));
create policy "document_boards_insert_member" on public.document_boards
  for insert with check (public.is_member(property_id));
create policy "document_boards_update_member" on public.document_boards
  for update using (public.is_member(property_id));
create policy "document_boards_delete_member" on public.document_boards
  for delete using (public.is_member(property_id));


-- Doc-to-board membership. A document lives on at most ONE board at a time
-- (sticky-note model) — enforced by the partial unique index. Re-pinning a
-- doc moves it between boards; unpinning removes it from boards entirely.

create table public.document_board_items (
  board_id uuid not null references public.document_boards(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  -- Within-board sparse-float ordering.
  position double precision not null,
  created_at timestamptz not null default now(),
  primary key (board_id, document_id)
);

-- A doc can only be pinned to ONE board. Without this, a drag-from-board-A
-- to-board-B that races a realtime echo could leave the doc in both boards.
create unique index document_board_items_one_per_doc_idx
  on public.document_board_items (document_id);

create index document_board_items_board_position_idx
  on public.document_board_items (board_id, position);

alter table public.document_board_items enable row level security;

-- Access is gated through the parent board's property — same `is_member`
-- check the boards table uses, traversed via a sub-select.
create policy "document_board_items_select_member" on public.document_board_items
  for select using (
    exists (
      select 1 from public.document_boards b
      where b.id = board_id and public.is_member(b.property_id)
    )
  );
create policy "document_board_items_insert_member" on public.document_board_items
  for insert with check (
    exists (
      select 1 from public.document_boards b
      where b.id = board_id and public.is_member(b.property_id)
    )
  );
create policy "document_board_items_update_member" on public.document_board_items
  for update using (
    exists (
      select 1 from public.document_boards b
      where b.id = board_id and public.is_member(b.property_id)
    )
  );
create policy "document_board_items_delete_member" on public.document_board_items
  for delete using (
    exists (
      select 1 from public.document_boards b
      where b.id = board_id and public.is_member(b.property_id)
    )
  );

-- Realtime: the docs home subscribes so a teammate's drag/create/delete shows
-- up live for everyone without polling.
alter publication supabase_realtime add table public.document_boards;
alter publication supabase_realtime add table public.document_board_items;
