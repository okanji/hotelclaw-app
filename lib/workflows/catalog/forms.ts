import { z } from "zod";
import { explainTemplateValue } from "@/lib/workflows/explain-template";
import { type StepCatalogEntry } from "./types";

// Forms surface: actions that put a form in front of the team. The matching
// `form.submitted` trigger lives in catalog/external.ts (submissions arrive
// like external posts), so a "send → fill → trigger" loop pairs this action
// with that trigger.

const actions: StepCatalogEntry[] = [
  {
    id: "action.form.send",
    surface: "forms",
    category: "action",
    label: "Send a form to a channel",
    description:
      "Post a form into a chat channel for the team to fill — pairs with the 'When a form is submitted' trigger.",
    examplePrompts: [
      "send the maintenance checklist to #engineering every morning",
      "post the incident form when a guest complaint comes in",
    ],
    outputSchema: z.object({
      message_id: z.string(),
      channel_id: z.string(),
      form_id: z.string(),
    }),
    explain: (config) => {
      const c = config as { channel_id?: string };
      const channel = explainTemplateValue(c.channel_id);
      return channel ? `Send form to ${channel}` : "Send a form to a channel";
    },
  },
];

export const FORMS_ACTIONS = actions;
