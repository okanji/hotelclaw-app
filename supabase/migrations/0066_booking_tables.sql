-- Table mode for bookable services — the restaurant layer (also fits any
-- discrete-unit service: cabanas, lanes, courts). A service chooses its
-- booking mode:
--   capacity — pooled units per slot (existing behavior; spa, tours)
--   tables   — discrete resources with seat counts and a floor-plan
--              position; availability = "a free table fits the party",
--              bookings get a best-fit table assignment hosts can override.

alter table public.bookable_services
  add column booking_mode text not null default 'capacity'
    check (booking_mode in ('capacity', 'tables'));

create table public.service_resources (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.bookable_services(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Short label hosts shout across the room ("T1", "Patio 3").
  name text not null,
  seats int not null default 2 check (seats >= 1 and seats <= 50),
  -- Don't burn a 6-top on a deuce unless nothing else fits: parties below
  -- min_party only get this table when no smaller table is free.
  min_party int not null default 1 check (min_party >= 1),
  shape text not null default 'rect' check (shape in ('rect', 'round')),
  -- Floor-plan geometry on a 100×100 grid (percent of canvas).
  x real not null default 10,
  y real not null default 10,
  w real not null default 10,
  h real not null default 10,
  zone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index service_resources_service_idx
  on public.service_resources (service_id, created_at);

create trigger service_resources_touch_updated_at
  before update on public.service_resources
  for each row execute function public.touch_updated_at();

alter table public.service_resources enable row level security;
create policy service_resources_all on public.service_resources
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

-- Which table a booking sits at (table mode only; null until assigned in
-- capacity mode). Hosts can reassign from the seating map.
alter table public.bookings
  add column resource_id uuid references public.service_resources(id) on delete set null;

create index bookings_resource_time_idx
  on public.bookings (resource_id, starts_at)
  where resource_id is not null;

-- Host lifecycle: confirmed → SEATED (party at the table) → completed.
-- Seated occupies capacity exactly like confirmed/pending.
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'));

-- The seating map needs live table edits too (drag saves push to viewers).
alter publication supabase_realtime add table public.service_resources;
