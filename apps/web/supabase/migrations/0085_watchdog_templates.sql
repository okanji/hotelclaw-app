-- Monitoring-agent workflow templates (E2) — the "assistant manager that
-- watches the list" the PO built live in ClickUp, expressed on our runtime:
-- schedule.cron → action.task.query (0085's new read step) → AI reasoning →
-- channel post. Adaptive where it matters (the AI writes the "why it's
-- stuck / who should act" read), deterministic where it counts (the task
-- list comes from the query step, never invented).

insert into public.workflow_templates (slug, name, description, category, surfaces, spec)
values (
  'team-watchdog-daily',
  'Team watchdog — daily stuck-work report',
  'Every weekday morning, find open tasks untouched for 3+ days, have AI explain what looks stuck and who should act, and post the report to a channel.',
  'tasks',
  array['system', 'tasks', 'ai', 'chat'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Team watchdog — daily stuck-work report",
    "description": "Weekday-morning stuck-work report with AI reasoning.",
    "trigger": {
      "event_type": "schedule.cron",
      "schedule": { "cron": "0 8 * * 1-5" }
    },
    "entry_step_id": "find_stuck",
    "steps": {
      "find_stuck": {
        "id": "find_stuck",
        "type": "action.task.query",
        "config": {
          "status": "open",
          "due": "any",
          "stuck_days": 3,
          "limit": 25
        },
        "next": "reason"
      },
      "reason": {
        "id": "reason",
        "type": "ai.summarize_text",
        "config": {
          "input": "Stuck tasks (open, untouched 3+ days):\n{{steps.find_stuck.output.summary}}",
          "length": "short",
          "persona_hint": "You are the team's watchdog. In a few bullet lines: which items look genuinely stuck, the likely reason (unassigned, blocked, overdue), and who should act. If the list says 'No matching tasks', just say the board is moving."
        },
        "next": "report"
      },
      "report": {
        "id": "report",
        "type": "action.chat.post_message",
        "config": {
          "channel_id": "{{vars.report_channel_id}}",
          "text": "🕵️ **Daily watchdog** — {{steps.find_stuck.output.count}} stuck item(s)\n\n{{steps.reason.output.summary}}"
        }
      }
    },
    "variables": {
      "report_channel_id": {
        "type": "string",
        "description": "The channel to post the daily report into"
      }
    },
    "metadata": { "last_edited_by": "ai" }
  }
  $$::jsonb
),
(
  'overdue-daily-report',
  'Daily overdue-work report',
  'Every morning, list overdue tasks with owners and post them to a channel — the deterministic list plus a one-line AI read.',
  'tasks',
  array['system', 'tasks', 'ai', 'chat'],
  $$
  {
    "workflow_spec_version": 1,
    "name": "Daily overdue-work report",
    "description": "Morning overdue list with owners.",
    "trigger": {
      "event_type": "schedule.cron",
      "schedule": { "cron": "0 8 * * *" }
    },
    "entry_step_id": "find_overdue",
    "steps": {
      "find_overdue": {
        "id": "find_overdue",
        "type": "action.task.query",
        "config": {
          "status": "open",
          "due": "overdue",
          "limit": 30
        },
        "next": "report"
      },
      "report": {
        "id": "report",
        "type": "action.chat.post_message",
        "config": {
          "channel_id": "{{vars.report_channel_id}}",
          "text": "⏰ **Overdue this morning** — {{steps.find_overdue.output.count}} task(s)\n\n{{steps.find_overdue.output.summary}}"
        }
      }
    },
    "variables": {
      "report_channel_id": {
        "type": "string",
        "description": "The channel to post the overdue list into"
      }
    },
    "metadata": { "last_edited_by": "ai" }
  }
  $$::jsonb
)
on conflict (slug) do nothing;
