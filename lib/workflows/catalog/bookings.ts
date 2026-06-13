import { z } from "zod";
import { explainTemplateValue } from "@/lib/workflows/explain-template";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

// Booking triggers — fired by lib/bookings/availability.ts (creation) and
// the bookings server actions (cancellation), whether the booking came from
// a guest chatbot or staff. Lets properties chain automations: "when a
// tour is booked, create a prep task", "when a table is cancelled, post to
// #front-of-house".

const bookingPayload = {
  booking_id: z.string(),
  reference: z.string(),
  service_id: z.string(),
  service_name: z.string(),
  service_kind: z.string(),
  guest_name: z.string(),
  guest_phone: z.string().nullable(),
  party_size: z.number(),
  starts_at: z.string(),
  status: z.string(),
  source: z.string(),
};

const triggers: TriggerCatalogEntry[] = [
  {
    id: "booking.created",
    surface: "bookings",
    category: "trigger",
    label: "When a booking is made",
    description:
      "Runs when a guest books a service — a table, massage, tour — via a chatbot or when staff create one. Payload carries the service, guest, party size, start time, and status (pending or confirmed).",
    examplePrompts: [
      "when a tour is booked, create a prep task for the activities team",
      "when a table for 6+ is booked, mention the restaurant manager",
    ],
    outputSchema: z.object(bookingPayload),
    explain: () => "When a booking is made",
  },
  {
    id: "booking.cancelled",
    surface: "bookings",
    category: "trigger",
    label: "When a booking is cancelled",
    description:
      "Runs when a booking is cancelled (by staff, or by the guest through a chatbot). Useful for freeing prep tasks or notifying the team.",
    examplePrompts: ["when a booking is cancelled, post to #front-desk"],
    outputSchema: z.object(bookingPayload),
    explain: () => "When a booking is cancelled",
  },
];

export const BOOKING_TRIGGERS = triggers;

// Booking actions — run through the same deterministic availability engine
// as chatbot and staff bookings (hours + capacity always hold; the online
// notice rule is bypassed, automations are staff-shaped).

const actions: StepCatalogEntry[] = [
  {
    id: "action.booking.create",
    surface: "bookings",
    category: "action",
    label: "Create a booking",
    description:
      "Books a slot on a bookable service (table, spa, tour) for a guest — validated against the service's real hours and capacity; fails if the slot is full. Use template refs to pull the guest and time from the trigger.",
    examplePrompts: [
      "when the VIP arrival form is submitted, book the airport pickup",
      "when a suite guest checks in, reserve a dinner table for two that evening",
    ],
    outputSchema: z.object({
      booking: z.record(z.string(), z.unknown()),
    }),
    explain: (config) => {
      const c = config as { guest_name?: string; starts_at?: string };
      const guest = explainTemplateValue(c.guest_name);
      const when = explainTemplateValue(c.starts_at);
      if (guest && when) return `Book for ${guest} at ${when}`;
      return "Create a booking";
    },
  },
  {
    id: "action.booking.set_status",
    surface: "bookings",
    category: "action",
    label: "Confirm / cancel a booking",
    description:
      "Sets a booking's status — confirmed, cancelled, completed, or no_show. Pair with the 'When a booking is made' trigger to auto-confirm pending chatbot bookings that meet your rules (e.g. small parties).",
    examplePrompts: [
      "auto-confirm chatbot bookings for parties of 2 or fewer",
      "when a guest cancels their stay, cancel their spa booking",
    ],
    outputSchema: z.object({
      booking: z.record(z.string(), z.unknown()),
    }),
    explain: (config) => {
      const c = config as { status?: string };
      return c.status ? `Set booking to ${c.status}` : "Set booking status";
    },
  },
];

export const BOOKING_ACTIONS = actions;
