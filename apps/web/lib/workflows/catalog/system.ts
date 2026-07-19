import { z } from "zod";
import { explainTemplateValue } from "@/lib/workflows/explain-template";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

// System surface: triggers that don't belong to a content surface (schedule,
// manual), plus notify + gbrain + delegate actions.

const triggers: TriggerCatalogEntry[] = [
  {
    id: "schedule.cron",
    surface: "system",
    category: "trigger",
    label: "On a repeating schedule",
    description:
      "Runs automatically on a repeating schedule you set — for example, every Monday at 9am, or every day at 7am. You choose the days, time, and timezone.",
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
    description: "Runs exactly once, at a future date and time you pick.",
    examplePrompts: ["tomorrow at 3pm", "next Monday at 9am"],
    outputSchema: z.object({ fired_at: z.string().datetime() }),
    explain: () => "Once at a specific time",
  },
  {
    id: "manual.run",
    surface: "system",
    category: "trigger",
    label: "When someone presses Run",
    description:
      "The workflow runs only when someone presses the Run button. Useful for one-off playbooks you trigger by hand.",
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
    explain: (config) => {
      const c = config as { title?: string };
      const title = explainTemplateValue(c.title);
      return title ? `Notify user: ${title}` : "Notify a user";
    },
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
      const c = config as { role?: string; title?: string; body?: string };
      const role = c.role ? `all ${c.role}s` : "role";
      const title = explainTemplateValue(c.title);
      const body = explainTemplateValue(c.body);
      if (title && body) return `Notify ${role}: ${title} — ${body}`;
      if (title) return `Notify ${role}: ${title}`;
      return c.role ? `Notify ${role}` : "Notify role";
    },
  },
  {
    id: "action.gbrain.capture",
    surface: "system",
    category: "action",
    label: "Save to shared memory",
    description:
      "Saves a note into the property's shared memory so the AI — and future workflows — can recall it later.",
    examplePrompts: [
      "remember that this guest dislikes spicy food",
      "log this pattern to gbrain",
    ],
    outputSchema: z.object({ ok: z.boolean() }),
    explain: () => "Save to shared memory",
  },
  {
    id: "action.external.delegate_to_openclaw",
    surface: "external",
    category: "action",
    label: "Hand off to durable agent",
    description:
      "Hands off to the durable agent runtime for work that outlives this workflow — multi-step jobs that keep running in the background and can pause for human approval.",
    examplePrompts: [
      "delegate the follow-up investigation to the agent",
      "hand this goal to the durable agent",
    ],
    outputSchema: z.object({ delegated: z.boolean(), task_id: z.string().optional() }),
    explain: () => "Delegate to durable agent",
  },
];

export const SYSTEM_TRIGGERS = triggers;
export const SYSTEM_ACTIONS = actions;
