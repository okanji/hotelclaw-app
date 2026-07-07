-- Bookings — bookable services (tables, massages, tours…) with deterministic
-- slot availability, bookable by guests through chatbots and by staff from
-- the Bookings page (Home rail). Modeled on the converged industry shape
-- (OpenTable/Calendly/FareHarbor research, plan in chatbots feature docs):
-- weekly hours + slot interval + duration + capacity-per-slot, with party
-- size consuming capacity for tables/tours and not for 1:1 appointments.
-- Availability is computed in lib/bookings/availability.ts — never by a
-- model; bot tools only relay what the deterministic code returns.

create table public.bookable_services (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text,
  emoji text,
  kind text not null default 'appointment'
    check (kind in ('table', 'appointment', 'tour', 'other')),
  -- Versioned scheduling rules JSON (lib/bookings/schema.ts):
  -- weekly hours, slot interval, duration, capacity, lead time, horizon.
  schedule jsonb not null default '{"version":1}'::jsonb,
  -- IANA timezone the weekly hours are written in.
  timezone text not null default 'UTC',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bookable_services_property_idx
  on public.bookable_services (property_id, created_at desc);

create trigger bookable_services_touch_updated_at
  before update on public.bookable_services
  for each row execute function public.touch_updated_at();

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  service_id uuid not null references public.bookable_services(id) on delete cascade,
  -- Short human reference quoted to the guest ("BKG-7H2K4F").
  reference text not null unique,
  guest_name text not null,
  guest_phone text,
  guest_email text,
  party_size int not null default 1 check (party_size >= 1 and party_size <= 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes text,
  source text not null default 'staff' check (source in ('chatbot', 'staff')),
  chatbot_id uuid references public.chatbots(id) on delete set null,
  conversation_id uuid references public.chatbot_conversations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Availability computation reads "bookings for service X overlapping day Y".
create index bookings_service_time_idx
  on public.bookings (service_id, starts_at);
create index bookings_property_time_idx
  on public.bookings (property_id, starts_at desc);

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_updated_at();

alter table public.bookable_services enable row level security;
alter table public.bookings enable row level security;

-- Any member manages services and bookings (same trust model as chatbots).
create policy bookable_services_select on public.bookable_services
  for select using (public.is_member(property_id));
create policy bookable_services_insert on public.bookable_services
  for insert with check (public.is_member(property_id) and created_by = auth.uid());
create policy bookable_services_update on public.bookable_services
  for update using (public.is_member(property_id))
  with check (public.is_member(property_id));
create policy bookable_services_delete on public.bookable_services
  for delete using (public.is_member(property_id));

-- Guests book via the service client (chatbot tools); members read + manage.
create policy bookings_select on public.bookings
  for select using (public.is_member(property_id));
create policy bookings_insert on public.bookings
  for insert with check (public.is_member(property_id));
create policy bookings_update on public.bookings
  for update using (public.is_member(property_id))
  with check (public.is_member(property_id));
create policy bookings_delete on public.bookings
  for delete using (public.is_member(property_id));

-- Live day agenda (Supabase Realtime, not polling).
alter publication supabase_realtime add table public.bookings;

-- Chatbot conversations that end in a booking get their own outcome badge.
alter table public.chatbot_conversations
  drop constraint chatbot_conversations_outcome_check;
alter table public.chatbot_conversations
  add constraint chatbot_conversations_outcome_check
  check (outcome in ('open', 'resolved', 'order_placed', 'booking_made', 'escalated', 'unresolved'));
