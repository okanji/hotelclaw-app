import { z } from "zod";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

const triggers: TriggerCatalogEntry[] = [
  {
    id: "meeting.ended",
    surface: "meetings",
    category: "trigger",
    label: "When a meeting ends",
    description:
      "Fires when a video meeting ends. The meeting's details and how long it ran are available to later steps.",
    examplePrompts: ["when a meeting ends", "after a video call wraps up"],
    outputSchema: z.object({
      meeting: z.record(z.string(), z.unknown()),
      duration_seconds: z.number().optional(),
    }),
    explain: () => "When a meeting ends",
  },
  {
    id: "meeting.summary_ready",
    surface: "meetings",
    category: "trigger",
    label: "When a meeting summary is ready",
    description:
      "Fires when the AI-written summary of a meeting is ready. The summary, the meeting, and its action items are available to later steps.",
    examplePrompts: [
      "when an AI meeting summary is ready",
      "after the transcript is summarized",
    ],
    outputSchema: z.object({
      summary: z.record(z.string(), z.unknown()),
      meeting: z.record(z.string(), z.unknown()),
      action_items: z.array(z.record(z.string(), z.unknown())).optional(),
    }),
    explain: () => "When a meeting summary is ready",
  },
];

const actions: StepCatalogEntry[] = [
  {
    id: "action.meeting.create_followup_tasks",
    surface: "meetings",
    category: "action",
    label: "Create follow-up tasks from meeting",
    description:
      "Walks the meeting's action_items list and creates one task per item. Optionally assigns all of them to a single user.",
    examplePrompts: [
      "create follow-up tasks from action items",
      "turn the meeting notes into tasks for the manager",
    ],
    outputSchema: z.object({ created_count: z.number(), task_ids: z.array(z.string()) }),
    explain: () => "Create tasks from meeting action items",
  },
  {
    id: "action.meeting.share_summary_to_channel",
    surface: "meetings",
    category: "action",
    label: "Share meeting summary to channel",
    description:
      "Posts the AI-generated meeting summary into a chat channel as a formatted message.",
    examplePrompts: ["share the summary in #leadership"],
    outputSchema: z.object({ message: z.record(z.string(), z.unknown()) }),
    explain: () => "Share meeting summary in chat",
  },
];

export const MEETINGS_TRIGGERS = triggers;
export const MEETINGS_ACTIONS = actions;
