import { z } from "zod";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

// System surface: triggers that don't belong to a content surface (schedule,
// manual), plus notify + gbrain + delegate actions.

const triggers: TriggerCatalogEntry[] = [
  {
    id: "schedule.cron",
    surface: "system",
    category: "trigger",
    label: "On schedule (cron)",
    description:
      "Fires on a cron schedule (e.g. '0 9 * * 1' for every Monday at 9am). Specify timezone via the trigger config. Promotes the workflow to durable mode.",
    examplePrompts: [
      "every Monday at 9am",
      "every day at 7am",
      "every hour during business hours",
    ],
    outputSchema: z.object({ fired_at: z.string().datetime() }),
    explain: (filter) => {
      const f = (filter as { cron?: string }) ?? {};
      return f.cron ? `Cron: ${f.cron}` : "On schedule";
    },
  },
  {
    id: "schedule.at_time",
    surface: "system",
    category: "trigger",
    label: "Once at a specific time",
    description: "Fires exactly once at a future ISO datetime.",
    examplePrompts: ["tomorrow at 3pm", "next Monday at 9am"],
    outputSchema: z.object({ fired_at: z.string().datetime() }),
    explain: () => "Once at a specific time",
  },
  {
    id: "manual.run",
    surface: "system",
    category: "trigger",
    label: "Manual (Run button)",
    description:
      "The workflow runs only when a user clicks the Run button (or POSTs to /api/workflows/:id/run). Useful for one-off playbooks.",
    examplePrompts: ["manual run", "on demand only"],
    outputSchema: z.object({ run_by_user_id: z.string() }),
    explain: () => "Manual run",
  },
];

const actions: StepCatalogEntry[] = [
  {
    id: "action.notify.user",
    surface: "system",
    category: "action",
    label: "Notify a user",
    description:
      "Send an in-app notification to a specific user. Renders in their notification inbox + bell.",
    examplePrompts: ["ping the manager", "send a notification to Eli"],
    outputSchema: z.object({ notification_id: z.string() }),
    explain: () => "Notify a user",
  },
  {
    id: "action.notify.role",
    surface: "system",
    category: "action",
    label: "Notify everyone with a role",
    description:
      "Fan out an in-app notification to all property members with the given role (owner / manager / staff).",
    examplePrompts: ["notify all managers", "alert the owner team"],
    outputSchema: z.object({ notified_user_ids: z.array(z.string()) }),
    explain: (config) => {
      const c = config as { role?: string };
      return c.role ? `Notify all ${c.role}s` : "Notify role";
    },
  },
  {
    id: "action.gbrain.capture",
    surface: "system",
    category: "action",
    label: "Capture to gbrain memory",
    description:
      "Write a durable observation/signal into the property's gbrain knowledge graph. Other bots (and future workflow runs) can `search` against it.",
    examplePrompts: [
      "remember that this guest dislikes spicy food",
      "log this pattern to gbrain",
    ],
    outputSchema: z.object({ ok: z.boolean() }),
    explain: () => "Capture to gbrain memory",
  },
  {
    id: "action.external.delegate_to_openclaw",
    surface: "external",
    category: "action",
    label: "Delegate to OpenClaw (Tier 2)",
    description:
      "Hand off to OpenClaw (the persistent Tier 2 agent) for long-running, cross-surface, or skill-heavy work. Use when the task can't finish in this workflow (e.g. needs Composio skills, SMS, multi-day monitoring).",
    examplePrompts: [
      "let OpenClaw handle the follow-up monitoring",
      "delegate to OpenClaw for SMS notification",
    ],
    outputSchema: z.object({ delegated: z.boolean(), task_id: z.string().optional() }),
    explain: () => "Delegate to OpenClaw",
  },
];

export const SYSTEM_TRIGGERS = triggers;
export const SYSTEM_ACTIONS = actions;
