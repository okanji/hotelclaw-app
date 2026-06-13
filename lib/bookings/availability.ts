import "server-only";
/**
 * Deterministic availability + booking creation. NO model in this path —
 * bot tools and the staff slot picker both call these functions and only
 * relay the results (the house "no model in the number path" rule).
 *
 * Semantics (industry-converged, see research in plan):
 *   • Slots start every `slotIntervalMinutes` within the day's weekly
 *     ranges; `end` is the LAST-SEATING boundary — a slot may start any
 *     time strictly before it, and its `durationMinutes` occupancy may run
 *     past it (restaurant turn-time semantics; also gives tours discrete
 *     departures when interval == duration).
 *   • A slot's consumed capacity = Σ over pending/confirmed bookings
 *     overlapping [start, start+duration): party_size when the service
 *     counts covers/seats, else 1.
 *   • Bookable when remaining ≥ requested units, start ≥ now+minNotice,
 *     and the date is within horizonDays.
 *
 * Timezones: weekly hours are wall times in the service's IANA timezone.
 * Conversion uses the two-pass Intl offset trick — no tz dependency.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import {
  newBookingReference,
  parseServiceSchedule,
  WEEKDAYS,
  type ServiceSchedule,
  type Weekday,
} from "@/lib/bookings/schema";
import type { Database } from "@/lib/db/types";

export type BookableServiceRow =
  Database["public"]["Tables"]["bookable_services"]["Row"];
export type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];
export type ServiceResourceRow =
  Database["public"]["Tables"]["service_resources"]["Row"];

type ResourceLite = Pick<ServiceResourceRow, "id" | "seats" | "min_party" | "active">;
type BookingLite = Pick<
  BookingRow,
  "starts_at" | "ends_at" | "party_size" | "status" | "resource_id"
>;

export type Slot = {
  startsAt: string; // ISO instant
  endsAt: string;
  /** Wall-clock label in the service tz ("18:30") for prompts and pickers. */
  label: string;
  remaining: number;
};

const DAY_MS = 86_400_000;

/** Wall time in `timeZone` for a UTC instant, as {date: "YYYY-MM-DD", minutes}. */
function wallTimeOf(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** UTC instant for a wall time ("YYYY-MM-DD" + minutes) in `timeZone`.
 *  Two-pass offset correction handles DST boundaries. */
function wallTimeToUtc(date: string, minutes: number, timeZone: string): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  let guess = new Date(`${date}T${hh}:${mm}:00Z`);
  for (let i = 0; i < 2; i++) {
    const wall = wallTimeOf(guess, timeZone);
    const wallAsUtc = new Date(`${wall.date}T00:00:00Z`).getTime() + wall.minutes * 60_000;
    const targetAsUtc = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
    const diff = targetAsUtc - wallAsUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/** Calendar date → weekday key (tz-independent for a pure date). */
export function weekdayOf(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun
  return WEEKDAYS[(day + 6) % 7];
}

export function todayInTz(timeZone: string, now = new Date()): string {
  return wallTimeOf(now, timeZone).date;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const overlaps = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
) => aStart < bEnd && bStart < aEnd;

/**
 * Free tables that FIT a party in a window — table-mode core. A table
 * conflicts when an active booking assigned to it overlaps; unassigned
 * overlapping bookings each reserve one of the remaining free tables
 * (conservative — they'll be seated somewhere).
 */
export function freeFittingTables(
  resources: ResourceLite[],
  bookings: BookingLite[],
  windowStart: number,
  windowEnd: number,
  partySize: number,
  /** Gap around each existing booking before its unit frees up (rentals:
   *  cleaning/refuel). Busy window becomes [start − t, end + t). */
  turnaroundMs = 0,
): ResourceLite[] {
  const active = bookings.filter(
    (b) => b.status === "pending" || b.status === "confirmed" || b.status === "seated",
  );
  const overlapping = active.filter((b) =>
    overlaps(
      windowStart,
      windowEnd,
      new Date(b.starts_at).getTime() - turnaroundMs,
      new Date(b.ends_at).getTime() + turnaroundMs,
    ),
  );
  const takenIds = new Set(
    overlapping.map((b) => b.resource_id).filter(Boolean) as string[],
  );
  const unassignedCount = overlapping.filter((b) => !b.resource_id).length;

  const free = resources
    .filter((r) => r.active && r.seats >= partySize && !takenIds.has(r.id))
    // Best-fit order: tables whose min_party the party meets first (don't
    // burn a 6-top on a deuce), then smallest.
    .sort((a, b) => {
      const aPref = partySize >= a.min_party ? 0 : 1;
      const bPref = partySize >= b.min_party ? 0 : 1;
      return aPref - bPref || a.seats - b.seats;
    });
  // Unassigned bookings consume from the back (they'll take SOME table).
  return unassignedCount > 0 ? free.slice(0, -unassignedCount) : free;
}

/** Pure slot computation for one calendar date in the service tz. */
export function computeDaySlots(args: {
  schedule: ServiceSchedule;
  timezone: string;
  date: string; // "YYYY-MM-DD" in the service tz
  bookings: BookingLite[];
  partySize: number;
  /** Table/rental mode: the service's resources; capacity mode: omit. */
  resources?: ResourceLite[];
  /** Override booking length (rental mode: the guest's chosen duration). */
  durationMinutes?: number;
  now?: Date;
}): Slot[] {
  const { schedule, timezone, date } = args;
  const now = args.now ?? new Date();
  // Closed dates beat everything; date-specific hours beat weekly (this is
  // how one-off events exist: empty weekly + one dated range).
  if (schedule.closedDates.includes(date)) return [];
  const ranges = schedule.dates[date] ?? schedule.weekly[weekdayOf(date)] ?? [];
  if (ranges.length === 0) return [];
  const duration = args.durationMinutes ?? schedule.durationMinutes;
  const turnaroundMs = schedule.turnaroundMinutes * 60_000;

  // Horizon + past-date gate (compare calendar dates in the service tz).
  const today = todayInTz(timezone, now);
  if (date < today) return [];
  const horizonLimit = todayInTz(
    timezone,
    new Date(now.getTime() + schedule.horizonDays * DAY_MS),
  );
  if (date > horizonLimit) return [];

  const units = schedule.countPartySize ? args.partySize : 1;
  if (args.partySize > schedule.maxPartySize) return [];

  const active = args.bookings.filter(
    (b) => b.status === "pending" || b.status === "confirmed" || b.status === "seated",
  );
  const earliestStart = now.getTime() + schedule.minNoticeMinutes * 60_000;

  const slots: Slot[] = [];
  for (const range of ranges) {
    const rangeStart = timeToMinutes(range.start);
    const rangeEnd = timeToMinutes(range.end);
    for (
      let startMin = rangeStart;
      startMin < rangeEnd;
      startMin += schedule.slotIntervalMinutes
    ) {
      const startsAt = wallTimeToUtc(date, startMin, timezone);
      if (startsAt.getTime() < earliestStart) continue;
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);

      let remaining: number;
      if (args.resources) {
        // Table/rental mode: remaining = free units that fit this party.
        remaining = freeFittingTables(
          args.resources,
          args.bookings,
          startsAt.getTime(),
          endsAt.getTime(),
          args.partySize,
          turnaroundMs,
        ).length;
      } else {
        let consumed = 0;
        for (const b of active) {
          if (
            overlaps(
              startsAt.getTime(),
              endsAt.getTime(),
              new Date(b.starts_at).getTime() - turnaroundMs,
              new Date(b.ends_at).getTime() + turnaroundMs,
            )
          ) {
            consumed += schedule.countPartySize ? b.party_size : 1;
          }
        }
        remaining = schedule.capacityPerSlot - consumed;
      }
      if (remaining >= (args.resources ? 1 : units)) {
        const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
        const mm = String(startMin % 60).padStart(2, "0");
        slots.push({
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          label: `${hh}:${mm}`,
          remaining,
        });
      }
    }
  }
  return slots;
}

async function loadDayContext(service: BookableServiceRow, date: string) {
  const supabase = createServiceClient();
  // A booking from late the previous day can overlap early slots — pad the
  // query window by one day each side.
  const dayStart = wallTimeToUtc(date, 0, service.timezone);
  const bookingsP = supabase
    .from("bookings")
    .select("id, starts_at, ends_at, party_size, status, resource_id, created_at")
    .eq("service_id", service.id)
    .gte("starts_at", new Date(dayStart.getTime() - DAY_MS).toISOString())
    .lte("starts_at", new Date(dayStart.getTime() + 2 * DAY_MS).toISOString());
  const resourcesP =
    service.booking_mode === "tables" || service.booking_mode === "rental"
      ? supabase
          .from("service_resources")
          .select("id, seats, min_party, active")
          .eq("service_id", service.id)
      : Promise.resolve({ data: null });
  const [{ data: bookings }, { data: resources }] = await Promise.all([
    bookingsP,
    resourcesP,
  ]);
  return {
    bookings: (bookings ?? []) as (BookingLite & { id: string; created_at: string })[],
    resources: (resources ?? undefined) as ResourceLite[] | undefined,
  };
}

/**
 * Resolve the booking length for a service: rental mode validates the
 * guest's choice against the configured options (defaulting to the
 * shortest — Booqable's convention); everything else uses the fixed
 * duration. Returns null when an invalid rental duration was requested.
 */
export function resolveDuration(
  service: BookableServiceRow,
  schedule: ServiceSchedule,
  requestedMinutes?: number,
): number | null {
  if (service.booking_mode !== "rental" || schedule.rentalDurations.length === 0) {
    return schedule.durationMinutes;
  }
  if (requestedMinutes === undefined) return schedule.rentalDurations[0];
  return schedule.rentalDurations.includes(requestedMinutes)
    ? requestedMinutes
    : null;
}

/** Load the day's bookings (and units) and compute open slots. */
export async function getServiceAvailability(args: {
  service: BookableServiceRow;
  date: string;
  partySize: number;
  durationMinutes?: number;
  now?: Date;
}): Promise<Slot[]> {
  const schedule = parseServiceSchedule(args.service.schedule);
  const duration = resolveDuration(args.service, schedule, args.durationMinutes);
  if (duration === null) return [];
  const { bookings, resources } = await loadDayContext(args.service, args.date);
  return computeDaySlots({
    schedule,
    timezone: args.service.timezone,
    date: args.date,
    bookings,
    partySize: args.partySize,
    resources,
    durationMinutes: duration,
    now: args.now,
  });
}

export type CreateBookingResult =
  | { ok: true; booking: BookingRow }
  | { ok: false; error: string; alternatives?: Slot[] };

/**
 * Validate + create a booking. The slot is recomputed server-side from live
 * bookings — the caller (bot or staff form) never decides whether a slot is
 * free. After insert, capacity is re-counted and the booking rolls back if
 * a concurrent insert oversold the slot (optimistic concurrency; plenty at
 * this scale). Emits `booking.created` for the workflows feature.
 */
export async function createBookingChecked(args: {
  service: BookableServiceRow;
  startsAt: string;
  partySize: number;
  guestName: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  notes?: string | null;
  autoConfirm: boolean;
  source: import("@/lib/db/types").BookingSource;
  chatbotId?: string | null;
  conversationId?: string | null;
  createdBy?: string | null;
  /** Rental mode: the guest's chosen duration (must be a configured option). */
  durationMinutes?: number;
  /** Staff can book past online rules (walk-ins, post-cutoff). */
  bypassRules?: boolean;
  now?: Date;
}): Promise<CreateBookingResult> {
  const schedule = parseServiceSchedule(args.service.schedule);
  const duration = resolveDuration(args.service, schedule, args.durationMinutes);
  if (duration === null) {
    return {
      ok: false,
      error: `Duration must be one of: ${schedule.rentalDurations
        .map((m) => (m % 60 === 0 ? `${m / 60}h` : `${m}min`))
        .join(", ")}`,
    };
  }
  // A timestamp WITHOUT an offset must be wall time in the SERVICE's
  // timezone — never the server's. (`new Date("…T14:00:00")` parses in the
  // server zone; a bot once booked 12:00Z for a "14:00" request that way.)
  const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.exec(args.startsAt.trim());
  const requested = naive
    ? wallTimeToUtc(
        args.startsAt.slice(0, 10),
        Number(args.startsAt.slice(11, 13)) * 60 + Number(args.startsAt.slice(14, 16)),
        args.service.timezone,
      )
    : new Date(args.startsAt);
  if (Number.isNaN(requested.getTime())) {
    return { ok: false, error: "Invalid start time" };
  }
  if (args.partySize < 1 || args.partySize > schedule.maxPartySize) {
    return {
      ok: false,
      error: `Party size must be between 1 and ${schedule.maxPartySize} for this service`,
    };
  }

  const date = wallTimeOf(requested, args.service.timezone).date;
  const { bookings: dayBookings, resources } = await loadDayContext(
    args.service,
    date,
  );
  const slots = computeDaySlots({
    schedule,
    timezone: args.service.timezone,
    date,
    bookings: dayBookings,
    partySize: args.partySize,
    resources,
    durationMinutes: duration,
    // Staff bypass relaxes the notice rule by evaluating "now" at the slot
    // itself; schedule hours + capacity still apply.
    now: args.bypassRules ? new Date(requested.getTime() - 1) : args.now,
  });
  const slot = slots.find(
    (s) => new Date(s.startsAt).getTime() === requested.getTime(),
  );
  if (!slot) {
    return {
      ok: false,
      error: "That time isn't available",
      alternatives: slots.slice(0, 5),
    };
  }

  // Table mode: best-fit assignment (smallest free table the party fits,
  // preferring tables whose min_party they meet). Hosts can reassign later.
  let resourceId: string | null = null;
  if (resources) {
    const fitting = freeFittingTables(
      resources,
      dayBookings,
      new Date(slot.startsAt).getTime(),
      new Date(slot.endsAt).getTime(),
      args.partySize,
      schedule.turnaroundMinutes * 60_000,
    );
    if (fitting.length === 0) {
      return { ok: false, error: "That time isn't available", alternatives: slots.slice(0, 5) };
    }
    resourceId = fitting[0].id;
  }

  const supabase = createServiceClient();
  const reference = newBookingReference();
  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      property_id: args.service.property_id,
      service_id: args.service.id,
      reference,
      guest_name: args.guestName,
      guest_phone: args.guestPhone ?? null,
      guest_email: args.guestEmail ?? null,
      party_size: args.partySize,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      status: args.autoConfirm ? "confirmed" : "pending",
      notes: args.notes ?? null,
      source: args.source,
      chatbot_id: args.chatbotId ?? null,
      conversation_id: args.conversationId ?? null,
      resource_id: resourceId,
      created_by: args.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error || !booking) {
    return { ok: false, error: error?.message ?? "Couldn't create the booking" };
  }

  // Post-insert oversell check: recount the slot including our row; if the
  // capacity is exceeded, the LATEST insert (ours, by created_at/id) yields.
  const turnaroundMs = schedule.turnaroundMinutes * 60_000;
  const { data: overlapping } = await supabase
    .from("bookings")
    .select("id, party_size, created_at, resource_id")
    .eq("service_id", args.service.id)
    .in("status", ["pending", "confirmed", "seated"])
    .lt("starts_at", new Date(new Date(slot.endsAt).getTime() + turnaroundMs).toISOString())
    .gt("ends_at", new Date(new Date(slot.startsAt).getTime() - turnaroundMs).toISOString());

  const rollback = async (): Promise<CreateBookingResult> => {
    await supabase.from("bookings").delete().eq("id", booking.id);
    return {
      ok: false,
      error: "That time was just taken",
      alternatives: (
        await getServiceAvailability({
          service: args.service,
          date,
          partySize: args.partySize,
          now: args.now,
        })
      ).slice(0, 5),
    };
  };

  if (resources) {
    // Table mode: did a concurrent insert land on OUR table?
    const tableClash = (overlapping ?? []).filter(
      (b) => b.resource_id === resourceId,
    );
    if (tableClash.length > 1) {
      const newest = [...tableClash].sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      )[0];
      if (newest?.id === booking.id) {
        // Try another free table before giving up.
        const others = freeFittingTables(
          resources,
          (overlapping ?? [])
            .filter((b) => b.id !== booking.id)
            .map((b) => ({
              starts_at: slot.startsAt,
              ends_at: slot.endsAt,
              party_size: b.party_size,
              status: "confirmed" as const,
              resource_id: b.resource_id,
            })),
          new Date(slot.startsAt).getTime(),
          new Date(slot.endsAt).getTime(),
          args.partySize,
          turnaroundMs,
        ).filter((r) => r.id !== resourceId);
        if (others.length > 0) {
          await supabase
            .from("bookings")
            .update({ resource_id: others[0].id })
            .eq("id", booking.id);
          booking.resource_id = others[0].id;
        } else {
          return rollback();
        }
      }
    }
  } else {
    const unitsOf = (b: { party_size: number }) =>
      schedule.countPartySize ? b.party_size : 1;
    const total = (overlapping ?? []).reduce((sum, b) => sum + unitsOf(b), 0);
    if (total > schedule.capacityPerSlot) {
      const newest = [...(overlapping ?? [])].sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      )[0];
      if (newest?.id === booking.id) return rollback();
    }
  }

  await emitWorkflowEvent({
    propertyId: args.service.property_id,
    source: "booking",
    eventType: "booking.created",
    entityId: booking.id,
    entityKind: "booking",
    payload: {
      booking_id: booking.id,
      reference: booking.reference,
      service_id: args.service.id,
      service_name: args.service.name,
      service_kind: args.service.kind,
      guest_name: booking.guest_name,
      guest_phone: booking.guest_phone,
      party_size: booking.party_size,
      starts_at: booking.starts_at,
      status: booking.status,
      source: booking.source,
      chatbot_id: booking.chatbot_id,
    },
  });

  return { ok: true, booking };
}

/** Friendly slot list for bot replies and confirmations ("Fri Jun 12, 18:30"). */
export function formatSlotForGuest(slot: Slot, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(slot.startsAt));
}
