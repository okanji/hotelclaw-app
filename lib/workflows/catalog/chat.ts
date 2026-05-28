import { z } from "zod";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

const triggers: TriggerCatalogEntry[] = [
  {
    id: "chat.message_posted",
    surface: "chat",
    category: "trigger",
    label: "Message posted in chat",
    description:
      "Fires on every non-bot message in a team channel. Payload exposes {{trigger.message}}, {{trigger.channel}}, {{trigger.user}}. Filter by channel_id, keyword, or user.",
    examplePrompts: [
      "when someone posts in #front-desk",
      "every message in the housekeeping channel",
    ],
    outputSchema: z.object({
      message: z.record(z.string(), z.unknown()),
      channel: z.record(z.string(), z.unknown()),
      user: z.record(z.string(), z.unknown()),
    }),
    explain: () => "When a chat message is posted",
  },
  {
    id: "chat.mention",
    surface: "chat",
    category: "trigger",
    label: "User mentioned in chat",
    description:
      "Fires when a specific user is @-mentioned in any channel. Filter by user_id.",
    examplePrompts: [
      "when the GM is @-mentioned",
      "whenever the manager-on-duty is mentioned",
    ],
    outputSchema: z.object({
      message: z.record(z.string(), z.unknown()),
      mentioned_user_id: z.string(),
    }),
    explain: () => "When a user is mentioned",
  },
];

const actions: StepCatalogEntry[] = [
  {
    id: "action.chat.post_message",
    surface: "chat",
    category: "action",
    label: "Post message to channel",
    description:
      "Post a top-level message in a channel. Text supports {{...}} refs. Returns the posted message at {{steps.<id>.output.message}}.",
    examplePrompts: ["post in #escalations", "send a message to the front-desk channel"],
    outputSchema: z.object({ message: z.record(z.string(), z.unknown()) }),
    explain: () => "Post a message to a chat channel",
  },
  {
    id: "action.chat.post_thread_reply",
    surface: "chat",
    category: "action",
    label: "Reply in a thread",
    description:
      "Post a reply inside an existing message thread. Requires channel_id and parent_id (the parent message).",
    examplePrompts: ["reply in the same thread", "post follow-up as a thread reply"],
    outputSchema: z.object({ message: z.record(z.string(), z.unknown()) }),
    explain: () => "Reply in a thread",
  },
  {
    id: "action.chat.mention_user",
    surface: "chat",
    category: "action",
    label: "Mention user in chat",
    description:
      "Post a message that @-mentions a user, generating a notification. Use when you want someone to be paged.",
    examplePrompts: ["mention the manager-on-duty", "ping Eli"],
    outputSchema: z.object({ message: z.record(z.string(), z.unknown()) }),
    explain: () => "Mention a user in chat",
  },
];

export const CHAT_TRIGGERS = triggers;
export const CHAT_ACTIONS = actions;
