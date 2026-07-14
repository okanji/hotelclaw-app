import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  getServiceAvailability,
  type BookableServiceRow,
} from "@/lib/bookings/availability";

/**
 * GET .../bookings/availability?serviceId&date&partySize — slot picker data
 * for the staff manual-booking dialog. Same deterministic engine the bot
 * tools use; staff see ALL slots for the day (notice rule relaxed —
 * walk-ins/phone bookings happen past cutoff).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const serviceId = request.nextUrl.searchParams.get("serviceId") ?? "";
  const date = request.nextUrl.searchParams.get("date") ?? "";
  const partySize = Math.max(
    1,
    Number(request.nextUrl.searchParams.get("partySize") ?? "1") || 1,
  );
  const durationRaw = Number(
    request.nextUrl.searchParams.get("durationMinutes") ?? "",
  );
  const durationMinutes = Number.isFinite(durationRaw) && durationRaw > 0
    ? durationRaw
    : undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: service } = await supabase
    .from("bookable_services")
    .select("*")
    .eq("id", serviceId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!service) return NextResponse.json({ error: "service not found" }, { status: 404 });

  const slots = await getServiceAvailability({
    service: service as BookableServiceRow,
    date,
    partySize,
    durationMinutes,
    // Staff see every slot for the day — notice rule relaxed (walk-ins/phone
    // bookings happen past cutoff). This matches createBookingChecked's
    // bypassRules so the picker and the create never disagree.
    ignoreNotice: true,
  });
  return NextResponse.json({ slots, timezone: service.timezone });
}
