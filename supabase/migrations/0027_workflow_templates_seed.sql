-- Seeded workflow templates. These show up in the Templates gallery; forking
-- creates a fresh workflow row + first version with a copy of the spec.
--
-- Templates use only catalog entries that ship in v1. Channel ids and assignee
-- ids are intentionally left as {{vars.*}} placeholders the user must fill in
-- before turning the workflow on — saves them from accidentally posting to
-- the wrong channel on day one.

insert into public.workflow_templates (slug, name, description, category, surfaces, spec)
values (
  'guest-complaint-escalation',
  'Guest complaint escalation',
  'When a task is labeled guest-complaint, AI summarizes it and escalates to all managers.',
  'guests',
  array['tasks', 'ai', 'system'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Guest complaint escalation",
    "description": "When a task is labeled guest-complaint, AI summarizes and notifies managers.",
    "trigger": {
      "event_type": "task.label_added",
      "filter": {
        "expr": { "in": ["guest-complaint", { "var": "trigger.added_labels" }] }
      }
    },
    "entry_step_id": "summarize",
    "steps": {
      "summarize": {
        "id": "summarize",
        "type": "ai.summarize_text",
        "config": {
          "input": "{{trigger.new.description}}",
          "length": "short",
          "persona_hint": "Triage the guest complaint — what's the issue and how urgent?"
        },
        "next": "notify"
      },
      "notify": {
        "id": "notify",
        "type": "action.notify.role",
        "config": {
          "role": "manager",
          "title": "Guest complaint escalated",
          "body": "{{steps.summarize.output.summary}}",
          "notification_type": "workflow"
        }
      }
    },
    "metadata": { "last_edited_by": "ai" }
  }
  $$::jsonb
),
(
  'overdue-task-escalation',
  'Overdue task escalation',
  'When a task passes its due date without being completed, ping all managers.',
  'tasks',
  array['tasks', 'system'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Overdue task escalation",
    "description": "When a task becomes overdue, notify managers.",
    "trigger": { "event_type": "task.overdue" },
    "entry_step_id": "notify",
    "steps": {
      "notify": {
        "id": "notify",
        "type": "action.notify.role",
        "config": {
          "role": "manager",
          "title": "Overdue task needs attention",
          "body": "Task \"{{trigger.new.title}}\" passed its due date.",
          "notification_type": "workflow"
        }
      }
    },
    "metadata": { "last_edited_by": "human" }
  }
  $$::jsonb
),
(
  'new-staff-welcome',
  'Welcome new staff (manual)',
  'Run on-demand to create a welcome task for a new staff member.',
  'comms',
  array['tasks', 'system'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Welcome new staff",
    "description": "Manual run — creates an onboarding checklist task.",
    "trigger": { "event_type": "manual.run" },
    "entry_step_id": "create",
    "steps": {
      "create": {
        "id": "create",
        "type": "action.task.create",
        "config": {
          "title": "Onboarding checklist",
          "description": "Complete the first-week onboarding checklist.",
          "labels": ["onboarding"],
          "priority": "high"
        }
      }
    },
    "metadata": { "last_edited_by": "human" }
  }
  $$::jsonb
),
(
  'lost-and-found-logger',
  'Lost & found logger',
  'AI scans chat messages for lost-item reports and creates a tracking task.',
  'comms',
  array['chat', 'ai', 'tasks'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Lost & found logger",
    "description": "Watches a channel for lost-item reports and files a task.",
    "trigger": { "event_type": "chat.message_posted" },
    "entry_step_id": "classify",
    "steps": {
      "classify": {
        "id": "classify",
        "type": "ai.branch_decision",
        "config": {
          "input": "{{trigger.message.text}}",
          "question": "Is this message reporting a lost or found item?"
        },
        "branches": { "true": "extract", "false": "end" }
      },
      "extract": {
        "id": "extract",
        "type": "ai.extract_fields",
        "config": {
          "input": "{{trigger.message.text}}",
          "fields": {
            "item": { "type": "string", "description": "The item lost or found", "required": true },
            "location": { "type": "string", "description": "Where it was last seen / found" }
          }
        },
        "next": "log"
      },
      "log": {
        "id": "log",
        "type": "action.task.create",
        "config": {
          "title": "Lost & found: {{steps.extract.output.fields.item}}",
          "description": "Location: {{steps.extract.output.fields.location}}\n\nFrom chat: {{trigger.message.text}}",
          "labels": ["lost-and-found"]
        }
      },
      "end": {
        "id": "end",
        "type": "control.end",
        "config": { "outcome": "not_a_lost_item" }
      }
    },
    "metadata": { "last_edited_by": "ai" }
  }
  $$::jsonb
),
(
  'meeting-action-items',
  'Meeting → follow-up tasks',
  'When a meeting summary is ready, create follow-up tasks from action items.',
  'reports',
  array['meetings', 'tasks'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Meeting follow-ups",
    "description": "Turns meeting action items into tasks once the AI summary lands.",
    "trigger": { "event_type": "meeting.summary_ready" },
    "entry_step_id": "create_followups",
    "steps": {
      "create_followups": {
        "id": "create_followups",
        "type": "action.meeting.create_followup_tasks",
        "config": {
          "meeting_id": "{{trigger.meeting.id}}"
        }
      }
    },
    "metadata": { "last_edited_by": "human" }
  }
  $$::jsonb
);
