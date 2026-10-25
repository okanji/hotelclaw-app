-- Tasks born into the triage queue (guest chatbot tickets, "Create triage
-- issue") are INSERTed with triage_state = 'pending'; 0111's planning trigger
-- is UPDATE-only, so their feed showed "created" but never "queued for
-- triage". Log that on insert too (after the 0106 `created` row).

create or replace function public.tasks_log_triage_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.triage_state = 'pending' then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'triage_queued',
      jsonb_build_object('note', new.triage_note),
      new.project_id, new.space_id,
      case new.source when 'workflow' then 'workflow' when 'ai' then 'ai' else null end);
  end if;
  return new;
end;
$$;

create trigger tasks_log_triage_insert_ai
  after insert on public.tasks
  for each row execute function public.tasks_log_triage_insert();
