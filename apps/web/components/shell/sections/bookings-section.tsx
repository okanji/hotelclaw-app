"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Hourglass, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  bookingServicesQueryOptions,
  pendingBookingsCountQueryOptions,
} from "@/lib/query/booking-queries";
import { SERVICE_KIND_META } from "@/lib/bookings/schema";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary sidebar for the Bookings section. The structure mirrors how the
 * business thinks: cross-service screens (Agenda, Pending) up top, then ONE
 * ITEM PER SERVICE — each opens its kind-specific workspace (a restaurant is
 * reservations + floor plan, a party is ticketing, a fleet is rentals).
 * Also owns the Realtime invalidation for the pending-count + services
 * queries — push via postgres_changes, never polling.
 */
export function BookingsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const base = `/p/${propertyId}/bookings`;
  const onList = pathname === base;
  const view = params.get("view") ?? "agenda";
  const focusedService = params.get("service");

  const { data: pendingCount = 0 } = useQuery(
    pendingBookingsCountQueryOptions(propertyId),
  );
  const { data: services = [] } = useQuery(
    bookingServicesQueryOptions(propertyId),
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bookings-count:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({
            queryKey: ["bookings-pending", propertyId],
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookable_services",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({
            queryKey: ["booking-services", propertyId],
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Bookings</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={base} />}
                isActive={onList && !focusedService && view === "agenda"}
                tooltip="All bookings"
              >
                <CalendarDays />
                <span>All bookings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}?view=pending`} />}
                isActive={onList && !focusedService && view === "pending"}
                tooltip="Pending"
              >
                <Hourglass />
                <span>Pending</span>
              </SidebarMenuButton>
              {pendingCount > 0 ? (
                <SidebarMenuBadge>{pendingCount}</SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {services.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Services</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {services.map((s) => (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton
                    render={<Link href={`${base}?service=${s.id}`} />}
                    isActive={onList && focusedService === s.id}
                    tooltip={s.name}
                    // A paused service is de-emphasised by INK, not opacity —
                    // the same faint rung the Chat sidebar spends on its
                    // Archived/Settings rows. `opacity-60` faded the emoji and
                    // the hover fill with it, which read as a broken row.
                    className={!s.active ? "text-faint-foreground" : undefined}
                  >
                    <span aria-hidden="true">
                      {s.emoji || SERVICE_KIND_META[s.kind].emoji}
                    </span>
                    <span className="truncate">{s.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`${base}?view=services`} />}
                  isActive={onList && !focusedService && view === "services"}
                  tooltip="Manage services"
                >
                  <Settings2 />
                  <span>Manage services</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`${base}?view=services`} />}
                  isActive={onList && !focusedService && view === "services"}
                  tooltip="Manage services"
                >
                  <Settings2 />
                  <span>Manage services</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}
