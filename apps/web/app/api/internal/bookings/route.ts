import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createBookingChecked } from "@/lib/bookings/availability";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * INTERNAL bookings endpoints for the eve runtime (service-bearer auth).
 * Bookings are NOT side-effect-free — creation must run the availability
 * engine (revalidation + oversell rollback + booking.created emission) and
 * status changes must respect the state machine + emit booking.cancelled —
 * so the runtime calls THIS instead of raw inserts.
 */

export const maxDuration = 60;

// Mirror of components/bookings/actions.ts STATUS_TRANSITIONS (that module
// is "use server" and not importable here; keep the two in sync).
const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["seated", "completed", "no_show", "cancelled"],
  seated: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

function authorized(request: NextRequest): boolean {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

const CreateBody = z.object({
  propertyId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startsAt: z.string().min(10),
  partySize: z.number().int().min(1).max(200),
  guestName: z.string().min(1).max(200),
  guestPhone: z.string().max(40).nullish(),
  notes: z.string().max(1000).nullish(),
  durationMinutes: z.number().int().min(15).max(24 * 60).nullish(),
});

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = CreateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const supabase = createServiceClient();
  const { data: service } = await supabase
    .from("bookable_services")
    .select("*")
    .eq("id", input.serviceId)
    .eq("property_id", input.propertyId)
    .maybeSingle();
  if (!service) {
    return NextResponse.json({ error: "Service not found in this property." }, { status: 404 });
  }
  // Staff-equivalent booking: rules bypassed (notice windows), auto-confirm.
  const result = await createBookingChecked({
    service,
    startsAt: input.startsAt,
    partySize: input.partySize,
    guestName: input.guestName,
    guestPhone: input.guestPhone ?? null,
    notes: input.notes ?? null,
    source: "staff",
    autoConfirm: true,
    bypassRules: true,
    ...(input.durationMinutes ? { durationMinutes: input.durationMinutes } : {}),
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        alternatives: (result.alternatives ?? []).slice(0, 6),
      },
      { status: 422 },
    );
  }
  return NextResponse.json({
    ok: true,
    booking: {
      reference: result.booking.reference,
      status: result.booking.status,
      starts_at: result.booking.starts_at,
      guest_name: result.booking.guest_name,
      party_size: result.booking.party_size,
    },
  });
}

const StatusBody = z.object({
  propertyId: z.string().uuid(),
  reference: z.string().min(4).max(20),
  status: z.enum(["confirmed", "seated", "completed", "no_show", "cancelled"]),
});

export async function PATCH(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = StatusBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const { propertyId, reference, status } = parsed.data;
  const supabase = createServiceClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, guest_name, service_id")
    .eq("property_id", propertyId)
    .eq("reference", reference.toUpperCase())
    .maybeSingle();
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (!STATUS_TRANSITIONS[booking.status]?.includes(status)) {
    return NextResponse.json(
      { error: `Can't move a ${booking.status} booking to ${status}.` },
      { status: 422 },
    );
  }
  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", booking.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (status === "cancelled") {
    await emitWorkflowEvent({
      propertyId,
      source: "booking",
      eventType: "booking.cancelled",
      entityId: booking.id,
      entityKind: "booking",
      payload: { reference, guest_name: booking.guest_name, service_id: booking.service_id },
    });
  }
  return NextResponse.json({ ok: true, reference, status });
}
