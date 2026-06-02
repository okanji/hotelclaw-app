import { z } from "zod";
import { explainTemplateValue } from "@/lib/workflows/explain-template";
import { type StepCatalogEntry } from "./types";

// External surface: outbound integrations that reach systems outside the app —
// a generic HTTP call, plus email (Resend) and messaging (Telegram / WhatsApp).
// Each runner is fail-soft: it works when its credentials are configured and
// returns a clear "not configured" result otherwise.

const actions: StepCatalogEntry[] = [
  {
    id: "action.http.request",
    surface: "external",
    category: "action",
    label: "Call a URL (HTTP request)",
    description:
      "Send an HTTP request to any URL — to hit another system's API, trigger a Slack/Discord webhook, or kick off a Zapier/Make hook. You choose the method, headers, and body.",
    examplePrompts: [
      "POST the task to our PMS API",
      "call the Slack incoming webhook",
      "notify our booking system",
    ],
    outputSchema: z.object({
      status: z.number(),
      ok: z.boolean(),
      body: z.string().optional(),
    }),
    explain: (config) => {
      const c = config as { method?: string; url?: string };
      const url = explainTemplateValue(c.url);
      return url ? `${c.method ?? "POST"} ${url}` : "Call a URL";
    },
  },
  {
    id: "action.email.send",
    surface: "external",
    category: "action",
    label: "Send an email",
    description:
      "Send an email via Resend — for example, to email a guest a confirmation or alert an external contact. Requires Resend to be configured.",
    examplePrompts: ["email the guest a confirmation", "send the summary to the GM's email"],
    outputSchema: z.object({ sent: z.boolean(), id: z.string().optional() }),
    explain: (config) => {
      const c = config as { to?: string; subject?: string };
      const to = explainTemplateValue(c.to);
      const subject = explainTemplateValue(c.subject);
      if (to && subject) return `Email ${to}: ${subject}`;
      if (to) return `Email ${to}`;
      return "Send an email";
    },
  },
  {
    id: "action.telegram.send",
    surface: "external",
    category: "action",
    label: "Send a Telegram message",
    description:
      "Send a message to a Telegram chat via your bot — handy for ops alerts to a staff group. Requires a Telegram bot token.",
    examplePrompts: ["telegram the night team", "ping our ops Telegram group"],
    outputSchema: z.object({ sent: z.boolean(), message_id: z.number().optional() }),
    explain: (config) => {
      const c = config as { chat_id?: string };
      const chat = explainTemplateValue(c.chat_id);
      return chat ? `Telegram → ${chat}` : "Send a Telegram message";
    },
  },
  {
    id: "action.whatsapp.send",
    surface: "external",
    category: "action",
    label: "Send a WhatsApp message",
    description:
      "Send a WhatsApp message via the WhatsApp Business Cloud API — e.g. a guest update or a staff alert. Requires WhatsApp Business to be configured.",
    examplePrompts: ["whatsapp the guest their room is ready", "message housekeeping on WhatsApp"],
    outputSchema: z.object({ sent: z.boolean(), message_id: z.string().optional() }),
    explain: (config) => {
      const c = config as { to?: string };
      const to = explainTemplateValue(c.to);
      return to ? `WhatsApp → ${to}` : "Send a WhatsApp message";
    },
  },
];

export const EXTERNAL_ACTIONS = actions;
