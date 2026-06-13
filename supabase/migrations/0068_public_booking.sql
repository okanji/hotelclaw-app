-- Public booking page — guests reserve directly at /book/<property-slug>
-- without the chatbot. Web bookings arrive as 'pending' (staff confirm from
-- the agenda/Pending view) and the guest gets an email with a signed
-- manage link (view + cancel; no account).

alter table public.bookings drop constraint bookings_source_check;
alter table public.bookings add constraint bookings_source_check
  check (source in ('chatbot', 'staff', 'web'));

-- Per-service visibility on the public page (bots/staff can still book
-- non-public services).
alter table public.bookable_services
  add column public_bookable boolean not null default true;
