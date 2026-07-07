-- Generic booking engine, round three: events (party/GA ticketing — a
-- one-off or recurring dated occasion with N tickets) and rentals
-- (cars/boats — a named unit hired for a guest-chosen duration with a
-- turnaround gap). Both reuse the existing machinery: events are
-- capacity-mode with date-specific hours; rentals are resource-mode with
-- variable duration. Scheduling additions live in the versioned schedule
-- JSON (lib/bookings/schema.ts) — no new tables needed.

alter table public.bookable_services
  drop constraint bookable_services_kind_check;
alter table public.bookable_services
  add constraint bookable_services_kind_check
  check (kind in ('table', 'appointment', 'tour', 'event', 'rental', 'other'));

alter table public.bookable_services
  drop constraint bookable_services_booking_mode_check;
alter table public.bookable_services
  add constraint bookable_services_booking_mode_check
  check (booking_mode in ('capacity', 'tables', 'rental'));
