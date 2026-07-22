-- 1) Enrich task.field_changed events: include the full task row plus
--    human-readable option labels (values store option ids), so workflow
--    steps can say "{{trigger.task.title}}: {{trigger.from_label}} →
--    {{trigger.to_label}}" without joins.
-- 2) Seed the "Maintenance material tracking" template — the Temple Point
--    maintenance flow's status→responsible-role broadcast, built on the
--    Material status custom field.

create or replace function public.task_field_values_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fld record;
  old_value jsonb;
  new_value jsonb;
  the_task_id uuid;
  the_property_id uuid;
  the_field_id uuid;
  task_row jsonb;
  from_label text;
  to_label text;
begin
  if (tg_op = 'DELETE') then
    old_value := old.value;
    new_value := null;
    the_task_id := old.task_id;
    the_property_id := old.property_id;
    the_field_id := old.field_id;
  elsif (tg_op = 'INSERT') then
    old_value := null;
    new_value := new.value;
    the_task_id := new.task_id;
    the_property_id := new.property_id;
    the_field_id := new.field_id;
  else
    if old.value = new.value then
      return new;
    end if;
    old_value := old.value;
    new_value := new.value;
    the_task_id := new.task_id;
    the_property_id := new.property_id;
    the_field_id := new.field_id;
  end if;

  select name, type, options into fld
  from public.custom_fields where id = the_field_id;

  select to_jsonb(t) into task_row from public.tasks t where t.id = the_task_id;

  -- Resolve select-option ids to labels (null for other types / cleared).
  if fld.type = 'select' then
    if old_value is not null then
      select o->>'label' into from_label
      from jsonb_array_elements(fld.options) o
      where o->>'id' = old_value #>> '{}';
    end if;
    if new_value is not null then
      select o->>'label' into to_label
      from jsonb_array_elements(fld.options) o
      where o->>'id' = new_value #>> '{}';
    end if;
  end if;

  perform public.emit_workflow_event(
    the_property_id, 'pg.tasks', 'task.field_changed', the_task_id, 'task',
    jsonb_build_object(
      'field_id', the_field_id,
      'field_name', fld.name,
      'field_type', fld.type,
      'from', old_value,
      'to', new_value,
      'from_label', coalesce(from_label, old_value #>> '{}'),
      'to_label', coalesce(to_label, new_value #>> '{}'),
      'task', task_row
    )
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- ── Maintenance material tracking template ─────────────────────────────────
-- The Temple Point flow: a Material status dropdown drives who acts next.
-- The template broadcasts every status move to the maintenance channel with
-- the responsible role called out; forkers fill the channel var and adjust
-- the role wording to their own org.

insert into public.workflow_templates (slug, name, description, category, surfaces, spec)
values (
  'maintenance-material-tracking',
  'Maintenance material tracking',
  'When a task''s Material status changes, post who owns the next step to the maintenance channel. Built for a Material status dropdown custom field (Request → Quoting → LPO approval → … → Finalized).',
  'tasks',
  array['tasks', 'ai', 'chat'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Maintenance material tracking",
    "description": "Broadcast Material status moves with the responsible role called out.",
    "trigger": {
      "event_type": "task.field_changed",
      "filter": {
        "expr": { "==": [{ "var": "trigger.field_name" }, "Material status"] }
      }
    },
    "entry_step_id": "route",
    "steps": {
      "route": {
        "id": "route",
        "type": "ai.summarize_text",
        "config": {
          "input": "Task: {{trigger.task.title}}. Material status moved from {{trigger.from_label}} to {{trigger.to_label}}. Responsibility map: Request/Preparation/Preventative routine = maintenance manager; Material check/Awaiting delivery = maintenance storekeeper; Quoting/Procurement/Budget allocated/Send LPO = procurement team; Quote approval/LPO approval = management; Budget check/Awaiting payment/Finalized payments = finance team; Ready to schedule/Scheduled/In progress = foreman; Ready for review = maintenance manager and foreman.",
          "length": "short",
          "persona_hint": "In one sentence, state the new status and exactly who should act next per the responsibility map. No preamble."
        },
        "next": "notify"
      },
      "notify": {
        "id": "notify",
        "type": "action.chat.post_message",
        "config": {
          "channel_id": "{{vars.maintenance_channel_id}}",
          "text": "🔧 {{trigger.task.title}} — {{trigger.from_label}} → {{trigger.to_label}}. {{steps.route.output.summary}}"
        }
      }
    },
    "variables": {
      "maintenance_channel_id": {
        "type": "string",
        "description": "The maintenance channel to post status moves into"
      }
    },
    "metadata": { "last_edited_by": "ai" }
  }
  $$::jsonb
)
on conflict (slug) do nothing;
