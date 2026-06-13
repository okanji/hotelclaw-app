import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

// React Query option factories for the bookings surface. The pending count
// feeds the rail badge + section sidebar; BookingsSection invalidates it via
// a Supabase Realtime subscription on `bookings` (push, not polling).

export type TodayBookingRow = {
  id: string;
  reference: string;
  guest_name: string;
  party_size: number;
  starts_at: string;
  status: "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";
  source: "chatbot" | "staff";
  service: { name: string; emoji: string | null; timezone: string } | null;
};

/** The next 24h of active bookings — feeds the Home widget. */
export function todaysBookingsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["bookings-today", propertyId] as const,
    queryFn: async (): Promise<TodayBookingRow[]> => {
      const supabase = createClient();
      const now = new Date();
      const { data } = await supabase
        .from("bookings")
        .select(
          `id, reference, guest_name, party_size, starts_at, status, source,
           service:bookable_services(name, emoji, timezone)`,
        )
        .eq("property_id", propertyId)
        .in("status", ["pending", "confirmed", "seated"])
        .gte("starts_at", new Date(now.getTime() - 60 * 60_000).toISOString())
        .lte("starts_at", new Date(now.getTime() + 24 * 60 * 60_000).toISOString())
        .order("starts_at")
        .limit(8);
      return (data ?? []) as unknown as TodayBookingRow[];
    },
    staleTime: 60_000,
  });
}

export type SidebarServiceRow = {
  id: string;
  name: string;
  emoji: string | null;
  kind: "table" | "appointment" | "tour" | "event" | "rental" | "other";
  active: boolean;
};

/** The property's bookable services — one sidebar item each, so every
 *  service opens its kind-specific workspace (reservations / ticketing /
 *  rentals / appointments). */
export function bookingServicesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["booking-services", propertyId] as const,
    queryFn: async (): Promise<SidebarServiceRow[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("bookable_services")
        .select("id, name, emoji, kind, active")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("created_at");
      return (data ?? []) as SidebarServiceRow[];
    },
    staleTime: 60_000,
  });
}

/** Pending (unconfirmed) bookings that haven't started yet — the "needs a
 *  human decision" number the front desk works down to zero. */
export function pendingBookingsCountQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["bookings-pending", propertyId] as const,
    queryFn: async (): Promise<number> => {
      const supabase = createClient();
      const { count } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("property_id", propertyId)
        .eq("status", "pending")
        .gte("starts_at", new Date().toISOString());
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}
