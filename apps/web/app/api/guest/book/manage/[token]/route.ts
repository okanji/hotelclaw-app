import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyManageToken } from "@/lib/bookings/manage-token";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";

/**
 * POST /api/guest/book/manage/:token — guest self-cancel from the signed
 * manage link. Only future, still-active bookings can be cancelled; emits
 * booking.cancelled so property workflows react.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const bookingId = verifyManageToken(token);
  if (!bookingId) return NextResponse.json({ error: "invalid link" }, { status: 404 });

  const supabase = createServiceClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return NextResponse.json(
      { error: `This booking is already ${booking.status}.` },
      { status: 409 },
    );
  }
  if (new Date(booking.starts_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This booking has already started — contact the venue." },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  return NextResponse.json({ ok: true });
}
