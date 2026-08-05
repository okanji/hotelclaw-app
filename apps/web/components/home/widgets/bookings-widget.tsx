"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  pendingBookingsCountQueryOptions,
  todaysBookingsQueryOptions,
} from "@/lib/query/booking-queries";
import { WidgetEmpty } from "../editorial-section";
import { Stat, StatGroup } from "@/components/ui/stat";

/**
 * The next 24 hours of guest bookings — who's arriving, for what, and the
 * pending count that needs a staff yes. Rows deep-link into Bookings.
 */
export function BookingsWidget({ propertyId }: { propertyId: string }) {
  const { data: bookings = [], isPending } = useQuery(
    todaysBookingsQueryOptions(propertyId),
  );
  const { data: pendingCount = 0 } = useQuery(
    pendingBookingsCountQueryOptions(propertyId),
  );

  if (isPending) return <WidgetEmpty>Loading bookings…</WidgetEmpty>;
  if (bookings.length === 0 && pendingCount === 0) {
    return (
      <WidgetEmpty>
        Nothing booked in the next 24 hours.{" "}
        <Link
          href={`/p/${propertyId}/bookings`}
          className="text-foreground underline-offset-2 hover:underline"
        >
          Open Bookings
        </Link>
      </WidgetEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StatGroup cols={2}>
        <Stat label="next 24h" value={bookings.length} />
        {pendingCount > 0 ? (
          <Stat label="pending" value={pendingCount} />
        ) : null}
      </StatGroup>

      <ul role="list" className="-mx-2 flex flex-col">
        {bookings.map((b) => {
          const time = new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: b.service?.timezone ?? "UTC",
          }).format(new Date(b.starts_at));
          return (
            <li key={b.id}>
              <Link
                href={`/p/${propertyId}/bookings${b.status === "pending" ? "?view=pending" : ""}`}
                className="group flex min-h-[37px] items-center gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    b.status === "pending" ? "bg-warning" : "bg-success",
                  )}
                  aria-hidden
                />
                <span className="w-16 shrink-0 tabular-nums">{time}</span>
                <span className="min-w-0 truncate group-hover:underline">
                  {b.service?.emoji ? `${b.service.emoji} ` : ""}
                  {b.service?.name ?? "Booking"} — {b.guest_name}
                </span>
                <span className="ml-auto shrink-0 tabular-nums">
                  ×{b.party_size}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {pendingCount > 0 ? (
        <Link
          href={`/p/${propertyId}/bookings?view=pending`}
          className="border-t border-border pt-3 text-sm text-muted-foreground hover:text-foreground"
        >
          {pendingCount} booking{pendingCount === 1 ? "" : "s"} waiting on a
          yes →
        </Link>
      ) : null}
    </div>
  );
}
