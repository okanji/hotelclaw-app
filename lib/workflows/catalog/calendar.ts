import { z } from "zod";
import { type TriggerCatalogEntry } from "./types";

const triggers: TriggerCatalogEntry[] = [
  {
    id: "calendar.event.created",
    surface: "calendar",
    category: "trigger",
    label: "When an external calendar event is created",
    description:
      "Fires when an external calendar (Google or Microsoft) syncs a new event. Useful for reacting to bookings or appointments.",
    examplePrompts: [
      "when a new event appears on the GM's calendar",
      "every time something is added to the booking calendar",
    ],
    outputSchema: z.object({
      event: z.record(z.string(), z.unknown()),
      calendar: z.record(z.string(), z.unknown()),
    }),
    explain: () => "When a calendar event is created",
  },
  {
    id: "calendar.conflict_detected",
    surface: "calendar",
    category: "trigger",
    label: "When a calendar conflict is detected",
    description:
      "Fires when a newly-created meeting overlaps with an existing event for any attendee. Payload includes the conflicting events.",
    examplePrompts: ["when there's a scheduling conflict", "when a double-booking happens"],
    outputSchema: z.object({
      meeting: z.record(z.string(), z.unknown()),
      conflicts: z.array(z.record(z.string(), z.unknown())),
    }),
    explain: () => "When a calendar conflict is detected",
  },
];

export const CALENDAR_TRIGGERS = triggers;
