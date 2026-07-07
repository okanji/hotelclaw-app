import { z } from "zod";

/**
 * Bookable-service scheduling rules — the versioned JSON in
 * `bookable_services.schedule` (forms/chatbots discipline: one shape shared
 * by the builder UI, the availability engine, and the bot tools).
 *
 * The vocabulary is the industry-converged set (Calendly/Cal.com/Fresha/
 * OpenTable): weekly hours, slot start interval, booking duration, capacity
 * per slot, minimum notice, booking horizon. Party-size capacity follows
 * the practitioner simplification: tables/tours consume `partySize` units
 * of capacity (covers/seats); appointments consume 1 (capacity = number of
 * concurrent chairs/therapists).
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeRangeZod = z
  .object({
    /** "HH:MM" 24h, in the service's timezone. */
    start: z.string().regex(TIME_RE),
    end: z.string().regex(TIME_RE),
  })
  .refine((r) => r.start < r.end, { message: "Range must end after it starts" });

/** Monday-first to match the calendar feature's weekday convention. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const ServiceScheduleZod = z.object({
  version: z.literal(1),
  /** Slot start spacing in minutes (Calendly "time-slot interval"). */
  slotIntervalMinutes: z.number().int().min(5).max(240).default(30),
  /** How long one booking occupies capacity (restaurant turn time, massage length, tour duration). */
  durationMinutes: z.number().int().min(5).max(480).default(60),
  /** Units available concurrently: covers for a table service, seats for a tour, chairs/therapists for appointments. */
  capacityPerSlot: z.number().int().min(1).max(500).default(1),
  /** Whether a party of N consumes N units (tables/tours) or 1 (appointments). */
  countPartySize: z.boolean().default(false),
  maxPartySize: z.number().int().min(1).max(100).default(8),
  /** Minimum notice before a slot can be booked (FareHarbor cutoff). */
  minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60).default(60),
  /** How far ahead booking is allowed, in days. */
  horizonDays: z.number().int().min(1).max(365).default(60),
  weekly: z.partialRecord(z.enum(WEEKDAYS), z.array(TimeRangeZod)).default({}),
  /**
   * Date-specific hours ("YYYY-MM-DD" → ranges). OVERRIDES weekly for that
   * date — this is how one-off events exist (a gala on July 4th, 20:00,
   * with empty weekly hours) and how special hours work.
   */
  dates: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.array(TimeRangeZod)).default({}),
  /** Dates with no availability regardless of weekly hours (holidays). */
  closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).default([]),
  /**
   * Rental mode: the durations a guest may choose, in minutes (4h/8h/24h…).
   * Non-rental services ignore this and always use durationMinutes.
   */
  rentalDurations: z.array(z.number().int().min(30).max(14 * 24 * 60)).max(8).default([]),
  /** Gap added after every booking before the unit is free again
   *  (cleaning/refuel for rentals, reset for anything). */
  turnaroundMinutes: z.number().int().min(0).max(24 * 60).default(0),
  /** Display-only pricing the bot may quote ("$45 per ticket", "€120/day").
   *  No payment processing — reserve now, pay at the venue. */
  priceLabel: z.string().max(120).default(""),
  /** A published form (Forms feature) whose questions guests answer while
   *  booking — dietary needs, waivers, onboarding. Responses land in
   *  form_responses (source 'booking') + a summary on the booking notes. */
  formId: z.string().uuid().optional(),
  /** Event landing-page customization (the Luma-style ticket page at
   *  /book/<property-slug>/event/<serviceId>). Only meaningful for kind
   *  "event"; absent = sensible defaults. */
  page: z
    .object({
      /** Cover-art gradient preset (see EVENT_COVER_PRESETS). */
      coverStyle: z.string().max(24).default("sunset"),
      /** Big emoji centered on the cover; empty = the service emoji. */
      coverEmoji: z.string().max(8).default(""),
      /** Accent for the CTA + selected chips. */
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#c96442"),
      tagline: z.string().max(160).default(""),
      location: z.string().max(160).default(""),
      /** "Hosted by …"; empty = the property name. */
      host: z.string().max(80).default(""),
      /** Long-form description, plain text with blank-line paragraphs. */
      about: z.string().max(4000).default(""),
    })
    .optional(),
});

export type ServiceSchedule = z.infer<typeof ServiceScheduleZod>;
export type TimeRange = z.infer<typeof TimeRangeZod>;
export type EventPageConfig = NonNullable<ServiceSchedule["page"]>;

export const DEFAULT_EVENT_PAGE: EventPageConfig = {
  coverStyle: "sunset",
  coverEmoji: "",
  accent: "#c96442",
  tagline: "",
  location: "",
  host: "",
  about: "",
};

/** Cover-art backgrounds for the event ticket page (Luma-style art block).
 *  Inline CSS `background` strings so guest + staff surfaces render
 *  identically — ordered basic → soft → vibrant → cosmic for the picker.
 *  Keys are stored in `schedule.page.coverStyle`; never rename existing
 *  ones (live pages reference them). */
export const EVENT_COVER_PRESETS: Record<string, { label: string; css: string }> = {
  // ── Basic — flat, quiet, lets the emoji carry it ──────────────────────
  cream: { label: "Cream", css: "#f3ede1" },
  stone: { label: "Stone", css: "#d8d4cb" },
  sage: { label: "Sage", css: "#cdd9c8" },
  sand: { label: "Sand", css: "#e8d6b8" },
  terracotta: { label: "Terracotta", css: "#c96442" },
  slate: { label: "Slate", css: "#3f4754" },
  ink: { label: "Ink", css: "#1f1e1b" },
  // ── Soft — barely-there washes ────────────────────────────────────────
  dawn: {
    label: "Dawn",
    css: "linear-gradient(160deg, #fdf2e9 0%, #f8d9c4 55%, #eebfa8 100%)",
  },
  mist: {
    label: "Mist",
    css: "linear-gradient(160deg, #f4f6f5 0%, #d9e2e4 55%, #b9c8cf 100%)",
  },
  lavender: {
    label: "Lavender",
    css: "linear-gradient(160deg, #f5f0fa 0%, #ded2f0 55%, #c3b2e3 100%)",
  },
  seafoam: {
    label: "Seafoam",
    css: "linear-gradient(160deg, #effaf5 0%, #cdeede 55%, #a4dcc4 100%)",
  },
  // ── Vibrant — the classic gradient posters ────────────────────────────
  sunset: {
    label: "Sunset",
    css: "linear-gradient(135deg, #f6d365 0%, #fda085 45%, #c96442 100%)",
  },
  ocean: {
    label: "Ocean",
    css: "linear-gradient(135deg, #a1c4fd 0%, #4f8edc 55%, #1e3a8a 100%)",
  },
  violet: {
    label: "Violet",
    css: "linear-gradient(135deg, #e0c3fc 0%, #9d6ae8 55%, #4c1d95 100%)",
  },
  forest: {
    label: "Forest",
    css: "linear-gradient(135deg, #d4fc79 0%, #4ca96b 55%, #14532d 100%)",
  },
  gold: {
    label: "Gold",
    css: "linear-gradient(135deg, #fdfcfb 0%, #e2c08c 55%, #92600a 100%)",
  },
  flamingo: {
    label: "Flamingo",
    css: "linear-gradient(135deg, #fbc2eb 0%, #f368b0 55%, #b91c5c 100%)",
  },
  citrus: {
    label: "Citrus",
    css: "linear-gradient(135deg, #fef9c3 0%, #fbbf24 55%, #ea580c 100%)",
  },
  miami: {
    label: "Miami",
    css: "linear-gradient(135deg, #f97794 0%, #a166ab 50%, #5b8def 100%)",
  },
  // ── Cosmic — layered, dark, big-night energy ──────────────────────────
  night: {
    label: "Night",
    css: "linear-gradient(135deg, #30343f 0%, #1b1e27 55%, #090a0f 100%)",
  },
  aurora: {
    label: "Aurora",
    css: "radial-gradient(120% 90% at 80% 0%, rgba(52,211,153,0.55) 0%, transparent 55%), radial-gradient(120% 90% at 15% 25%, rgba(96,165,250,0.5) 0%, transparent 60%), radial-gradient(140% 110% at 50% 100%, rgba(167,139,250,0.45) 0%, transparent 60%), #0b1220",
  },
  nebula: {
    label: "Nebula",
    css: "radial-gradient(100% 80% at 25% 20%, rgba(217,70,239,0.5) 0%, transparent 55%), radial-gradient(110% 90% at 80% 75%, rgba(99,102,241,0.55) 0%, transparent 60%), radial-gradient(70% 60% at 65% 30%, rgba(251,113,133,0.35) 0%, transparent 55%), #120a1f",
  },
  ember: {
    label: "Ember",
    css: "radial-gradient(110% 90% at 50% 100%, rgba(249,115,22,0.65) 0%, rgba(190,18,60,0.35) 45%, transparent 70%), #160b08",
  },
  spotlight: {
    label: "Spotlight",
    css: "radial-gradient(75% 65% at 50% 35%, rgba(250,247,241,0.28) 0%, transparent 65%), #15130f",
  },
  deepsea: {
    label: "Deep sea",
    css: "radial-gradient(120% 100% at 50% 0%, rgba(45,212,191,0.4) 0%, transparent 55%), radial-gradient(120% 100% at 50% 110%, rgba(30,64,175,0.6) 0%, transparent 65%), #041420",
  },
  holo: {
    label: "Holo",
    css: "conic-gradient(from 220deg at 50% 50%, #fbc2eb 0%, #a6c1ee 25%, #b9f0d8 50%, #fdf3b8 75%, #fbc2eb 100%)",
  },
};

export const EMPTY_SERVICE_SCHEDULE: ServiceSchedule = ServiceScheduleZod.parse({
  version: 1,
});

export function parseServiceSchedule(raw: unknown): ServiceSchedule {
  const parsed = ServiceScheduleZod.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_SERVICE_SCHEDULE;
}

/** Sensible per-kind starting points for the service editor. */
export function defaultScheduleForKind(
  kind: import("@/lib/db/types").BookableServiceKind,
): ServiceSchedule {
  switch (kind) {
    case "table":
      // 30-min grid, 90-min turn, covers-counted (research: the simplest
      // viable restaurant model).
      return ServiceScheduleZod.parse({
        version: 1,
        slotIntervalMinutes: 30,
        durationMinutes: 90,
        capacityPerSlot: 20,
        countPartySize: true,
        maxPartySize: 8,
        weekly: {
          mon: [{ start: "17:00", end: "21:30" }],
          tue: [{ start: "17:00", end: "21:30" }],
          wed: [{ start: "17:00", end: "21:30" }],
          thu: [{ start: "17:00", end: "21:30" }],
          fri: [{ start: "17:00", end: "22:00" }],
          sat: [{ start: "17:00", end: "22:00" }],
        },
      });
    case "tour":
      // Fixed departures: interval == duration gives discrete departures.
      return ServiceScheduleZod.parse({
        version: 1,
        slotIntervalMinutes: 120,
        durationMinutes: 120,
        capacityPerSlot: 12,
        countPartySize: true,
        maxPartySize: 12,
        minNoticeMinutes: 12 * 60,
        weekly: {
          mon: [{ start: "10:00", end: "16:00" }],
          wed: [{ start: "10:00", end: "16:00" }],
          fri: [{ start: "10:00", end: "16:00" }],
          sat: [{ start: "10:00", end: "16:00" }],
        },
      });
    case "event":
      // GA ticketing: one dated occasion, capacity = tickets, party = ticket
      // count. Weekly stays empty — the editor adds specific dates.
      return ServiceScheduleZod.parse({
        version: 1,
        slotIntervalMinutes: 240,
        durationMinutes: 240,
        capacityPerSlot: 100,
        countPartySize: true,
        maxPartySize: 10,
        minNoticeMinutes: 60,
        horizonDays: 180,
        weekly: {},
        priceLabel: "Pay at the door",
      });
    case "rental":
      // Units hired for a chosen duration; an hour of turnaround between
      // hires (research: cleaning/refuel gap is standard).
      return ServiceScheduleZod.parse({
        version: 1,
        slotIntervalMinutes: 60,
        durationMinutes: 240,
        capacityPerSlot: 1,
        countPartySize: false,
        maxPartySize: 8,
        minNoticeMinutes: 120,
        horizonDays: 90,
        rentalDurations: [240, 480, 1440],
        turnaroundMinutes: 60,
        weekly: {
          mon: [{ start: "08:00", end: "18:00" }],
          tue: [{ start: "08:00", end: "18:00" }],
          wed: [{ start: "08:00", end: "18:00" }],
          thu: [{ start: "08:00", end: "18:00" }],
          fri: [{ start: "08:00", end: "18:00" }],
          sat: [{ start: "08:00", end: "18:00" }],
          sun: [{ start: "08:00", end: "18:00" }],
        },
      });
    case "appointment":
      return ServiceScheduleZod.parse({
        version: 1,
        slotIntervalMinutes: 60,
        durationMinutes: 60,
        capacityPerSlot: 2,
        countPartySize: false,
        maxPartySize: 2,
        minNoticeMinutes: 120,
        weekly: {
          mon: [{ start: "09:00", end: "18:00" }],
          tue: [{ start: "09:00", end: "18:00" }],
          wed: [{ start: "09:00", end: "18:00" }],
          thu: [{ start: "09:00", end: "18:00" }],
          fri: [{ start: "09:00", end: "18:00" }],
          sat: [{ start: "10:00", end: "16:00" }],
          sun: [{ start: "10:00", end: "16:00" }],
        },
      });
    default:
      return EMPTY_SERVICE_SCHEDULE;
  }
}

export const SERVICE_KIND_META = {
  table: { label: "Restaurant table", emoji: "🍽️" },
  appointment: { label: "Appointment (spa, massage…)", emoji: "💆" },
  tour: { label: "Tour / activity", emoji: "🚌" },
  event: { label: "Event / party tickets", emoji: "🎉" },
  rental: { label: "Rental (cars, boats…)", emoji: "🚗" },
  other: { label: "Other", emoji: "📅" },
} as const;

/** Human booking reference, e.g. "BKG-7H2K4F" (no 0/O/1/I ambiguity). */
export function newBookingReference(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `BKG-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}
