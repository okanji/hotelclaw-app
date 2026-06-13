"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import {
  createBookingChecked,
  type BookableServiceRow,
} from "@/lib/bookings/availability";
import {
  newBookingReference,
  parseServiceSchedule,
  ServiceScheduleZod,
} from "@/lib/bookings/schema";
import type { BookingStatus } from "@/lib/db/types";

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(120);

export async function createService(input: {
  propertyId: string;
  name: string;
  kind: import("@/lib/db/types").BookableServiceKind;
  booking_mode?: import("@/lib/db/types").BookingMode;
  public_bookable?: boolean;
  emoji?: string | null;
  description?: string | null;
  schedule: unknown;
  timezone: string;
}): Promise<{ serviceId: string } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const name = Name.safeParse(input.name);
  const schedule = ServiceScheduleZod.safeParse(input.schedule);
  if (!pid.success) return { error: "Invalid property" };
  if (!name.success) return { error: "Service name is required" };
  if (!schedule.success) return { error: "Invalid schedule" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("bookable_services")
    .insert({
      property_id: pid.data,
      name: name.data,
      kind: input.kind,
      booking_mode: input.booking_mode ?? "capacity",
      public_bookable: input.public_bookable ?? true,
      emoji: input.emoji?.trim() || null,
      description: input.description?.trim() || null,
      schedule: schedule.data,
      timezone: input.timezone || "UTC",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to create service" };

  revalidatePath(`/p/${pid.data}/bookings`);
  return { serviceId: data.id };
}

export async function updateService(input: {
  serviceId: string;
  patch: {
    name?: string;
    kind?: import("@/lib/db/types").BookableServiceKind;
    booking_mode?: import("@/lib/db/types").BookingMode;
    public_bookable?: boolean;
    emoji?: string | null;
    description?: string | null;
    schedule?: unknown;
    timezone?: string;
    active?: boolean;
    archived_at?: string | null;
  };
}): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(input.serviceId);
  if (!id.success) return { error: "Invalid service" };
  let schedule;
  if (input.patch.schedule !== undefined) {
    const parsed = ServiceScheduleZod.safeParse(input.patch.schedule);
    if (!parsed.success) return { error: "Invalid schedule" };
    schedule = parsed.data;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { schedule: _rawSchedule, ...rest } = input.patch;
  void _rawSchedule;
  const { data, error } = await supabase
    .from("bookable_services")
    .update({ ...rest, ...(schedule ? { schedule } : {}) })
    .eq("id", id.data)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Service not found" };

  revalidatePath(`/p/${data.property_id}/bookings`);
  return { ok: true };
}

export async function deleteService(
  serviceId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(serviceId);
  if (!id.success) return { error: "Invalid service" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("bookable_services")
    .delete()
    .eq("id", id.data)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Service not found" };

  revalidatePath(`/p/${data.property_id}/bookings`);
  return { ok: true };
}

/**
 * Staff-side booking (walk-in, phone). Bypasses the minimum-notice rule —
 * hours and live capacity still apply (research: manual bookings bypass
 * online rules everywhere).
 */
export async function createManualBooking(input: {
  serviceId: string;
  startsAt: string;
  partySize: number;
  guestName: string;
  guestPhone?: string;
  notes?: string;
  durationMinutes?: number;
}): Promise<{ reference: string } | ActionError> {
  const id = Uuid.safeParse(input.serviceId);
  if (!id.success) return { error: "Invalid service" };
  const guestName = Name.safeParse(input.guestName);
  if (!guestName.success) return { error: "Guest name is required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // RLS-scoped read proves membership; the checked-create uses the service
  // client internally.
  const { data: service } = await supabase
    .from("bookable_services")
    .select("*")
    .eq("id", id.data)
    .maybeSingle();
  if (!service) return { error: "Service not found" };

  const result = await createBookingChecked({
    service: service as BookableServiceRow,
    startsAt: input.startsAt,
    partySize: input.partySize,
    guestName: guestName.data,
    guestPhone: input.guestPhone?.trim() || null,
    notes: input.notes?.trim() || null,
    autoConfirm: true,
    source: "staff",
    createdBy: user.id,
    durationMinutes: input.durationMinutes,
    bypassRules: true,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/p/${service.property_id}/bookings`);
  return { reference: result.booking.reference };
}

/**
 * Host-stand walk-in: a party at the door, a free table on the floor plan.
 * Deliberately NOT createBookingChecked — that engine only accepts slot
 * boundaries, and a walk-in arrives at 19:43 on a table the host can see is
 * free. Direct insert at "now" with a same-table overlap guard instead.
 */
export async function seatWalkIn(input: {
  serviceId: string;
  resourceId: string;
  partySize: number;
  guestName?: string;
}): Promise<{ reference: string } | ActionError> {
  const serviceId = Uuid.safeParse(input.serviceId);
  const resourceId = Uuid.safeParse(input.resourceId);
  if (!serviceId.success || !resourceId.success) return { error: "Invalid table" };
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 50) {
    return { error: "Invalid party size" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // RLS-scoped reads prove membership and table↔service binding.
  const { data: service } = await supabase
    .from("bookable_services")
    .select("*")
    .eq("id", serviceId.data)
    .maybeSingle();
  if (!service) return { error: "Service not found" };
  const { data: resource } = await supabase
    .from("service_resources")
    .select("id, name, seats, active")
    .eq("id", resourceId.data)
    .eq("service_id", serviceId.data)
    .maybeSingle();
  if (!resource) return { error: "Table not found" };
  if (!resource.active) return { error: "That table is inactive" };
  if (input.partySize > resource.seats) {
    return { error: `${resource.name} only seats ${resource.seats}` };
  }

  const schedule = parseServiceSchedule(service.schedule);
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + schedule.durationMinutes * 60_000);

  // Guard: is anything active on this table during the stay?
  const { data: clash } = await supabase
    .from("bookings")
    .select("id")
    .eq("resource_id", resourceId.data)
    .in("status", ["pending", "confirmed", "seated"])
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString())
    .limit(1);
  if (clash && clash.length > 0) {
    return { error: `${resource.name} has a booking in that window` };
  }

  const service_ = createServiceClient();
  const reference = newBookingReference();
  const { data: booking, error } = await service_
    .from("bookings")
    .insert({
      property_id: service.property_id,
      service_id: serviceId.data,
      reference,
      guest_name: input.guestName?.trim() || "Walk-in",
      party_size: input.partySize,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "seated",
      source: "staff",
      resource_id: resourceId.data,
      created_by: user.id,
    })
    .select("id, reference")
    .single();
  if (error || !booking) return { error: error?.message ?? "Couldn't seat the walk-in" };

  await emitWorkflowEvent({
    propertyId: service.property_id,
    source: "booking",
    eventType: "booking.created",
    entityId: booking.id,
    entityKind: "booking",
    payload: {
      booking_id: booking.id,
      reference: booking.reference,
      service_id: serviceId.data,
      service_name: service.name,
      service_kind: service.kind,
      guest_name: input.guestName?.trim() || "Walk-in",
      guest_phone: null,
      party_size: input.partySize,
      starts_at: startsAt.toISOString(),
      status: "seated",
      source: "staff",
      chatbot_id: null,
    },
  });

  revalidatePath(`/p/${service.property_id}/bookings`);
  return { reference: booking.reference };
}

const STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["seated", "completed", "no_show", "cancelled"],
  seated: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

// ---------------------------------------------------------------------------
// Floor plan resources (tables)
// ---------------------------------------------------------------------------

const ResourceInput = z.object({
  id: Uuid.optional(),
  name: z.string().trim().min(1).max(24),
  seats: z.number().int().min(1).max(50),
  min_party: z.number().int().min(1).max(50),
  shape: z.enum(["rect", "round"]),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(2).max(100),
  h: z.number().min(2).max(100),
  zone: z.string().trim().max(40).nullable(),
  active: z.boolean(),
});

/** Replace a service's floor plan: upsert the given tables, delete the rest. */
export async function saveServiceResources(input: {
  serviceId: string;
  propertyId: string;
  resources: z.input<typeof ResourceInput>[];
}): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(input.serviceId);
  const pid = Uuid.safeParse(input.propertyId);
  if (!sid.success || !pid.success) return { error: "Invalid service" };
  const parsed = z.array(ResourceInput).max(80).safeParse(input.resources);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid floor plan" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: existing } = await supabase
    .from("service_resources")
    .select("id")
    .eq("service_id", sid.data);
  const keptIds = new Set(parsed.data.map((r) => r.id).filter(Boolean));
  const toDelete = (existing ?? []).filter((r) => !keptIds.has(r.id));
  if (toDelete.length > 0) {
    await supabase
      .from("service_resources")
      .delete()
      .in("id", toDelete.map((r) => r.id));
  }

  for (const r of parsed.data) {
    const record = {
      name: r.name,
      seats: r.seats,
      min_party: Math.min(r.min_party, r.seats),
      shape: r.shape,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      zone: r.zone,
      active: r.active,
    };
    const { error } = r.id
      ? await supabase.from("service_resources").update(record).eq("id", r.id)
      : await supabase.from("service_resources").insert({
          ...record,
          service_id: sid.data,
          property_id: pid.data,
        });
    if (error) return { error: error.message };
  }

  revalidatePath(`/p/${pid.data}/bookings`);
  return { ok: true };
}

/** Host override: move a booking to a table (or clear the assignment). */
export async function assignBookingResource(input: {
  bookingId: string;
  resourceId: string | null;
}): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(input.bookingId);
  if (!id.success) return { error: "Invalid booking" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("bookings")
    .update({ resource_id: input.resourceId })
    .eq("id", id.data)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Booking not found" };

  revalidatePath(`/p/${data.property_id}/bookings`);
  return { ok: true };
}

export async function setBookingStatus(input: {
  bookingId: string;
  status: BookingStatus;
}): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(input.bookingId);
  if (!id.success) return { error: "Invalid booking" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, property_id, status, reference, service_id, guest_name, guest_phone, party_size, starts_at, source",
    )
    .eq("id", id.data)
    .maybeSingle();
  if (!booking) return { error: "Booking not found" };
  if (!STATUS_TRANSITIONS[booking.status].includes(input.status)) {
    return { error: `Can't move a ${booking.status} booking to ${input.status}` };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: input.status })
    .eq("id", id.data);
  if (error) return { error: error.message };

  if (input.status === "cancelled") {
    const { data: service } = await supabase
      .from("bookable_services")
      .select("name, kind")
      .eq("id", booking.service_id)
      .maybeSingle();
    await emitWorkflowEvent({
      propertyId: booking.property_id,
      source: "booking",
      eventType: "booking.cancelled",
      entityId: booking.id,
      entityKind: "booking",
      payload: {
        booking_id: booking.id,
        reference: booking.reference,
        service_id: booking.service_id,
        service_name: service?.name ?? "",
        service_kind: service?.kind ?? "",
        guest_name: booking.guest_name,
        guest_phone: booking.guest_phone,
        party_size: booking.party_size,
        starts_at: booking.starts_at,
        status: "cancelled",
        source: booking.source,
      },
    });
  }

  revalidatePath(`/p/${booking.property_id}/bookings`);
  return { ok: true };
}
