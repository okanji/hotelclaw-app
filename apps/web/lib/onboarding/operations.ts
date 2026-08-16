/**
 * What a property runs on-site — the single source for the wizard's step-5
 * options AND the website-enrichment whitelist.
 *
 * These lived in two places (the wizard's chip list and the enrich route's
 * `OPERATION_IDS` enum) and drifted the moment the wizard's list grew: the
 * route could only ever suggest the eight ids it knew, so a café's website
 * could not prefill "Café / counter" no matter what the page said. One list,
 * imported by both.
 *
 * `blurb` says what WE set up, not what the thing is — the user knows what a
 * spa is; what they can't know is that ticking it creates an appointment
 * service with therapists and durations.
 *
 * Adding an id here is safe end to end: `starterBookingServices()` matches
 * only the handful it has templates for, and everything else flows to the AI
 * planner as context.
 */

export type OperationOption = {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
};

export const OPERATION_GROUPS: {
  group: string;
  options: OperationOption[];
}[] = [
  {
    group: "Stays",
    options: [
      {
        id: "rooms",
        label: "Rooms / stays",
        emoji: "🛏️",
        blurb: "Guest rooms, check-in and check-out, housekeeping rounds.",
      },
      {
        id: "rentals",
        label: "Rentals",
        emoji: "🚗",
        blurb: "Kit or vehicles guests take out by the hour or the day.",
      },
      {
        id: "parking",
        label: "Parking / valet",
        emoji: "🅿️",
        blurb: "Spaces guests reserve, or keys your team takes in.",
      },
    ],
  },
  {
    group: "Food & drink",
    options: [
      {
        id: "restaurant",
        label: "Restaurant",
        emoji: "🍽️",
        blurb: "Table reservations with party sizes and turn times.",
      },
      {
        id: "bar",
        label: "Bar",
        emoji: "🍸",
        blurb: "Walk-ins, tabs, and last orders.",
      },
      {
        id: "cafe",
        label: "Café / counter",
        emoji: "☕",
        blurb: "Quick counter service and takeaway orders.",
      },
      {
        id: "room_service",
        label: "Room service",
        emoji: "🛎️",
        blurb: "In-room orders routed straight to the kitchen.",
      },
      {
        id: "catering",
        label: "Catering",
        emoji: "🧁",
        blurb: "Private and off-site catering enquiries and quotes.",
      },
    ],
  },
  {
    group: "Wellness & leisure",
    options: [
      {
        id: "spa",
        label: "Spa / wellness",
        emoji: "💆",
        blurb: "Treatment appointments booked against therapists and rooms.",
      },
      {
        id: "gym",
        label: "Gym / fitness",
        emoji: "🏋️",
        blurb: "Classes and equipment slots guests sign up for.",
      },
      {
        id: "pool",
        label: "Pool / beach",
        emoji: "🏖️",
        blurb: "Loungers, cabanas, and towel and safety checks.",
      },
    ],
  },
  {
    group: "Experiences",
    options: [
      {
        id: "tours",
        label: "Tours / activities",
        emoji: "🥾",
        blurb: "Guided departures with a capacity per time slot.",
      },
      {
        id: "events",
        label: "Events / venue hire",
        emoji: "🎉",
        blurb: "Weddings, conferences, and private hire of your spaces.",
      },
      {
        id: "transport",
        label: "Transport / transfers",
        emoji: "🚐",
        blurb: "Airport runs, shuttles, and driver scheduling.",
      },
    ],
  },
  {
    group: "Other services",
    options: [
      {
        id: "retail",
        label: "Retail / shop",
        emoji: "🛍️",
        blurb: "A shop or boutique selling to guests.",
      },
      {
        id: "laundry",
        label: "Guest laundry",
        emoji: "🧺",
        blurb: "Laundry and dry-cleaning requests with turnaround times.",
      },
      {
        id: "coworking",
        label: "Coworking / meeting rooms",
        emoji: "🖥️",
        blurb: "Desks and meeting rooms booked by the hour.",
      },
    ],
  },
];

export const OPERATIONS_OPTIONS: OperationOption[] = OPERATION_GROUPS.flatMap(
  (g) => g.options,
);

/** Whitelist the enrich route validates the model's guesses against. */
export const OPERATION_IDS = OPERATIONS_OPTIONS.map((o) => o.id) as [
  string,
  ...string[],
];

/**
 * Operations that imply a team worth creating. Used to widen the department
 * presets from what the website actually showed — a hotel whose site has a
 * spa page should arrive at step 3 with a Spa & Wellness team already on.
 *
 * Deliberately partial: `rooms` implies no single team (every team touches
 * rooms) and `tours`/`gym` have no conventional department name, so they map
 * to nothing rather than inventing one. The wizard dedupes these against the
 * type preset by taxonomy family, so "Restaurant" won't double up with a
 * preset's "Food & Beverage".
 */
export const DEPARTMENT_FOR_OPERATION: Record<string, string> = {
  spa: "Spa & Wellness",
  restaurant: "Food & Beverage",
  bar: "Bar",
  events: "Sales & Events",
  transport: "Transport",
  laundry: "Laundry",
  retail: "Retail",
};
