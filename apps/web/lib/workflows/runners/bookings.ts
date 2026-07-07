import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createBookingChecked,
  type BookableServiceRow,
} from "@/lib/bookings/availability";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import type { RunnerImpl } from "./types";

// Booking actions — workflows book and manage slots through the SAME
// deterministic engine the chatbot tools and staff dialog use
// (lib/bookings/availability.ts): hours + capacity always hold; the
// minimum-notice rule is bypassed like staff bookings (automations are
// staff-shaped). Examples: "when the VIP form is submitted, book the
// airport pickup", "when a chatbot booking is created for ≤2 people,
// auto-confirm it".

type CreateBookingConfig = {
  service_id: string;
  starts_at: string;
  guest_name: string;
  party_size?: string;
  guest_phone?: string;
  notes?: string;
};

export const createBookingRunner: RunnerImpl<
  CreateBookingConfig,
  { booking: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      booking: {
        id: `dry-${ctx.stepId}`,
        reference: "BKG-DRYRUN",
        ...config,
      },
    };
  }
  const supabase = createServiceClient();
  const { data: service } = await supabase
    .from("bookable_services")
    .select("*")
    .eq("id", config.service_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!service) throw new Error("create_booking failed: service not found");

  const result = await createBookingChecked({
    service: service as BookableServiceRow,
    startsAt: config.starts_at,
    partySize: Math.max(1, Number(config.party_size) || 1),
    guestName: config.guest_name,
    guestPhone: config.guest_phone ?? null,
    notes: config.notes ?? null,
    autoConfirm: true,
    source: "staff",
    createdBy: ctx.workflowOwnerId,
    bypassRules: true,
  });
  if (!result.ok) {
    throw new Error(`create_booking failed: ${result.error}`);
  }
  return { booking: result.booking as unknown as Record<string, unknown> };
};

type SetBookingStatusConfig = {
  booking_id: string;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
};

export const setBookingStatusRunner: RunnerImpl<
  SetBookingStatusConfig,
  { booking: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return { booking: { id: config.booking_id, status: config.status } };
  }
  const supabase = createServiceClient();
  const { data: booking, error } = await supabase
    .from("bookings")
    .update({ status: config.status })
    .eq("id", config.booking_id)
    .eq("property_id", ctx.propertyId)
    .select("*")
    .single();
  if (error) throw new Error(`set_booking_status failed: ${error.message}`);

  if (config.status === "cancelled") {
    const { data: service } = await supabase
      .from("bookable_services")
      .select("name, kind")
      .eq("id", booking.service_id)
      .maybeSingle();
    await emitWorkflowEvent({
      propertyId: ctx.propertyId,
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
        status: booking.status,
        source: booking.source,
      },
    });
  }
  return { booking: booking as unknown as Record<string, unknown> };
};
