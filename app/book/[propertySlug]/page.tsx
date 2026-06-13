import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { parseServiceSchedule } from "@/lib/bookings/schema";
import { loadBookingForm } from "@/lib/bookings/booking-form";
import {
  PublicBookingPage,
  type PublicService,
} from "@/components/public-booking/public-booking-page";

/**
 * Public booking page — /book/<property-slug>, allowlisted in middleware.
 * The shareable "reserve / book / buy tickets" page for guests who aren't
 * in a chat. Only guest-safe fields cross to the client.
 */
export default async function BookPage({
  params,
}: {
  params: Promise<{ propertySlug: string }>;
}) {
  const { propertySlug } = await params;
  const supabase = createServiceClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name, slug")
    .eq("slug", propertySlug)
    .is("archived_at", null)
    .maybeSingle();
  if (!property) notFound();

  const { data: rows } = await supabase
    .from("bookable_services")
    .select("id, name, emoji, kind, description, booking_mode, schedule, timezone")
    .eq("property_id", property.id)
    .eq("active", true)
    .eq("public_bookable", true)
    .is("archived_at", null)
    .order("created_at");

  const services: PublicService[] = await Promise.all(
    (rows ?? []).map(async (s) => {
      const schedule = parseServiceSchedule(s.schedule);
      return {
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      kind: s.kind,
      description: s.description,
      maxPartySize: schedule.maxPartySize,
      priceLabel: schedule.priceLabel,
        rentalDurations: s.booking_mode === "rental" ? schedule.rentalDurations : [],
        eventDates: s.kind === "event" ? Object.keys(schedule.dates).sort() : [],
        timezone: s.timezone,
        form: await loadBookingForm(schedule.formId, property.id),
      };
    }),
  );

  if (services.length === 0) notFound();

  return (
    <PublicBookingPage propertySlug={property.slug} propertyName={property.name} services={services} />
  );
}
