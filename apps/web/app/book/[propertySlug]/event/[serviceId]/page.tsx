import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import {
  DEFAULT_EVENT_PAGE,
  parseServiceSchedule,
} from "@/lib/bookings/schema";
import { loadBookingForm } from "@/lib/bookings/booking-form";
import { EventPage } from "@/components/public-booking/event-page";

/**
 * The event ticket page — /book/<property-slug>/event/<serviceId>. A
 * Luma-style landing page per event: cover art, date tile, location,
 * registration card. Customization lives in `schedule.page` (versioned
 * JSON, staff-edited from the event workspace). Middleware allowlists
 * the whole /book/ prefix.
 */
export default async function EventTicketPage({
  params,
}: {
  params: Promise<{ propertySlug: string; serviceId: string }>;
}) {
  const { propertySlug, serviceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(serviceId)) notFound();
  const supabase = createServiceClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name, slug")
    .eq("slug", propertySlug)
    .is("archived_at", null)
    .maybeSingle();
  if (!property) notFound();

  const { data: service } = await supabase
    .from("bookable_services")
    .select("id, name, emoji, kind, description, schedule, timezone, active, public_bookable")
    .eq("id", serviceId)
    .eq("property_id", property.id)
    .eq("kind", "event")
    .is("archived_at", null)
    .maybeSingle();
  if (!service || !service.active || !service.public_bookable) notFound();

  const schedule = parseServiceSchedule(service.schedule);
  const page = { ...DEFAULT_EVENT_PAGE, ...(schedule.page ?? {}) };
  const bookingForm = await loadBookingForm(schedule.formId, property.id);
  const today = new Date().toISOString().slice(0, 10);
  const dates = Object.keys(schedule.dates)
    .sort()
    .filter((d) => d >= today && !schedule.closedDates.includes(d));

  return (
    <EventPage
      propertySlug={property.slug}
      propertyName={property.name}
      service={{
        id: service.id,
        name: service.name,
        emoji: service.emoji,
        description: service.description,
        timezone: service.timezone,
        maxPartySize: schedule.maxPartySize,
        capacity: schedule.capacityPerSlot,
        priceLabel: schedule.priceLabel,
      }}
      page={page}
      dates={dates}
      form={bookingForm}
    />
  );
}
