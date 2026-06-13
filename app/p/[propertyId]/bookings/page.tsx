import { createClient } from "@/lib/supabase/server";
import {
  BookingsView,
  type BookingListItem,
  type ServiceListItem,
} from "@/components/bookings/bookings-view";

/**
 * Bookings — services + the day agenda (the manifest screen every booking
 * system converges on). Server fetches a generous window around today; the
 * client filters by selected day so date navigation is instant, and a
 * Realtime subscription refreshes when bots write new rows.
 */
export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ view?: string; service?: string }>;
}) {
  const { propertyId } = await params;
  const { view, service } = await searchParams;
  const supabase = await createClient();

  const now = new Date();
  const windowStart = new Date(now.getTime() - 2 * 86400_000).toISOString();
  const windowEnd = new Date(now.getTime() + 60 * 86400_000).toISOString();

  const [{ data: services }, { data: bookings }, { data: resources }] =
    await Promise.all([
      supabase
        .from("bookable_services")
        .select("*")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("created_at"),
      supabase
        .from("bookings")
        .select(
          "id, service_id, reference, guest_name, guest_phone, party_size, starts_at, ends_at, status, notes, source, resource_id",
        )
        .eq("property_id", propertyId)
        .gte("starts_at", windowStart)
        .lte("starts_at", windowEnd)
        .order("starts_at"),
      supabase
        .from("service_resources")
        .select("*")
        .eq("property_id", propertyId)
        .order("created_at"),
    ]);

  const { data: property } = await supabase
    .from("properties")
    .select("slug")
    .eq("id", propertyId)
    .maybeSingle();

  const validViews = ["pending", "services", "floor", "timetable"] as const;
  return (
    <BookingsView
      propertyId={propertyId}
      propertySlug={property?.slug ?? null}
      services={(services ?? []) as ServiceListItem[]}
      bookings={(bookings ?? []) as BookingListItem[]}
      resources={resources ?? []}
      view={
        validViews.includes(view as (typeof validViews)[number])
          ? (view as (typeof validViews)[number])
          : "agenda"
      }
      focusServiceId={
        service && (services ?? []).some((s) => s.id === service)
          ? service
          : null
      }
    />
  );
}
