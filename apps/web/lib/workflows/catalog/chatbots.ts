import { z } from "zod";
import { type TriggerCatalogEntry } from "./types";

// Guest-chatbot triggers — fired by the guest-bot tool registry
// (lib/ai/guest-bot/tools/*) when a guest-facing chatbot takes an action.
// Lets properties chain automations off bot activity: "when a room-service
// order comes in, mention the F&B manager", "when a bot escalates, create a
// follow-up task".

const conversationContext = {
  chatbot_id: z.string(),
  chatbot_name: z.string(),
  conversation_id: z.string(),
  guest_name: z.string().nullable(),
  room_number: z.string().nullable(),
};

const triggers: TriggerCatalogEntry[] = [
  {
    id: "chatbot.order_created",
    surface: "external",
    category: "trigger",
    label: "When a chatbot takes an order or request",
    description:
      "Runs when a guest chatbot files a ticket — a room-service order, a maintenance request, a reservation. The payload carries the created task id plus the order details and guest info the bot collected.",
    examplePrompts: [
      "when the room service bot takes an order, mention the F&B manager",
      "when a chatbot files a maintenance request, set it urgent",
    ],
    outputSchema: z.object({
      ...conversationContext,
      task_id: z.string(),
      kind: z.string(),
      title: z.string(),
      details: z.string(),
    }),
    explain: () => "When a chatbot takes an order or request",
  },
  {
    id: "chatbot.lead_captured",
    surface: "external",
    category: "trigger",
    label: "When a chatbot collects guest details",
    description:
      "Runs when a guest chatbot collects contact details (name, email, phone, room). Useful for follow-up sequences or syncing to an external system.",
    examplePrompts: ["when a chatbot captures a guest email, send a welcome email"],
    outputSchema: z.object({
      ...conversationContext,
      guest_email: z.string().nullable(),
      guest_phone: z.string().nullable(),
    }),
    explain: () => "When a chatbot collects guest details",
  },
  {
    id: "chatbot.escalated",
    surface: "external",
    category: "trigger",
    label: "When a chatbot escalates to a human",
    description:
      "Runs when a guest conversation is handed to your team — by the bot's judgment or the guest tapping 'Talk to a human'. The payload carries the AI's summary and a link to the conversation.",
    examplePrompts: [
      "when a chatbot escalates, create an urgent task for the duty manager",
    ],
    outputSchema: z.object({
      ...conversationContext,
      summary: z.string(),
      reason: z.string(),
    }),
    explain: () => "When a chatbot escalates to a human",
  },
];

export const CHATBOT_TRIGGERS = triggers;
