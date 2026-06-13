-- Forms attached to bookable services: guests answer the organizer's extra
-- questions (dietary, waivers, onboarding) while booking. Responses land in
-- form_responses with the new 'booking' source; the form↔service link lives
-- in bookable_services.schedule.formId (versioned JSON, no column).

alter table public.form_responses
  drop constraint if exists form_responses_source_check;

alter table public.form_responses
  add constraint form_responses_source_check
  check (source in ('direct', 'chat', 'workflow', 'onboarding', 'booking'));
