"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { parseServiceSchedule } from "@/lib/bookings/schema";
import type { BookingStatus } from "@/lib/db/types";
import { BOOKING_STATUS_UI } from "@/lib/bookings/status-colors";
import type { BookingListItem, ServiceListItem } from "./bookings-view";
import type { ResourceItem } from "./floor-plan";
import { assignBookingResource, setBookingStatus } from "./actions";

/**
 * The reservations timeline (the OpenTable/SevenRooms grid): rows = tables
 * (plus an Unassigned lane), x = time, blocks span the turn time. Capacity
 * services get greedy-packed lanes instead of table rows. Click a block for
 * status actions and table re-assignment; the rose rule marks "now".
 * Mobile collapses to the Agenda list — the grid is a desktop tool.
 */

const STATUS_BLOCK: Record<BookingStatus, string> = Object.fromEntries(
  Object.entries(BOOKING_STATUS_UI).map(([k, v]) => [k, v.block]),
) as Record<BookingStatus, string>;

const NEXT_ACTIONS: Partial<Record<BookingStatus, { label: string; status: BookingStatus }[]>> = {
  pending: [
    { label: "Confirm", status: "confirmed" },
    { label: "Cancel", status: "cancelled" },
  ],
  confirmed: [
    { label: "Seat", status: "seated" },
    { label: "No-show", status: "no_show" },
    { label: "Cancel", status: "cancelled" },
  ],
  seated: [{ label: "Finish", status: "completed" }],
};

export function Timetable({
  service,
  resources,
  bookings,
  day,
}: {
  service: ServiceListItem;
  resources: (ResourceItem & { id: string })[];
  bookings: BookingListItem[];
  day: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Rows-from-resources applies to tables AND rental units — both are
  // discrete things a booking occupies.
  const tableMode =
    (service.booking_mode === "tables" || service.booking_mode === "rental") &&
    resources.length > 0;
  // "Now" captured post-mount — render stays pure for the compiler.
  const [nowTs, setNowTs] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNowTs(Date.now()), []);

  const dayBookings = useMemo(
    () =>
      bookings
        .filter(
          (b) => b.service_id === service.id && b.starts_at.slice(0, 10) === day,
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [bookings, service.id, day],
  );

  // Time window: the service's earliest open to latest close that day, with
  // an hour of slack each side; fall back to the bookings' own span.
  const timeWindow = useMemo(() => {
    const times = dayBookings.flatMap((b) => [
      new Date(b.starts_at).getTime(),
      new Date(b.ends_at).getTime(),
    ]);
    if (times.length === 0) return null;
    const start = Math.min(...times) - 30 * 60_000;
    const end = Math.max(...times) + 30 * 60_000;
    return { start, end, span: end - start };
  }, [dayBookings]);

  // Rows: tables (+ Unassigned lane) in table mode, greedy-packed lanes in
  // capacity mode. Plain computation — the React Compiler memoizes it.
  let rows: { id: string; label: string; sub: string; bookings: BookingListItem[] }[];
  if (tableMode) {
    const byTable = new Map<string | null, BookingListItem[]>();
    for (const b of dayBookings) {
      const key = b.resource_id ?? null;
      byTable.set(key, [...(byTable.get(key) ?? []), b]);
    }
    rows = resources.map((r) => ({
      id: r.id,
      label: r.name,
      // Rental units aren't seat-counted.
      sub: service.booking_mode === "tables" ? `${r.seats} seats` : "",
      bookings: byTable.get(r.id) ?? [],
    }));
    const unassigned = byTable.get(null) ?? [];
    if (unassigned.length > 0) {
      rows = [
        { id: "unassigned", label: "Unassigned", sub: "", bookings: unassigned },
        ...rows,
      ];
    }
  } else {
    const lanes: BookingListItem[][] = [];
    for (const b of dayBookings) {
      const start = new Date(b.starts_at).getTime();
      const lane = lanes.find(
        (l) => new Date(l[l.length - 1].ends_at).getTime() <= start,
      );
      if (lane) lane.push(b);
      else lanes.push([b]);
    }
    rows = lanes.map((l, i) => ({
      id: `lane-${i}`,
      label: i === 0 ? service.name : "",
      sub: "",
      bookings: l,
    }));
  }

  function act(booking: BookingListItem, status: BookingStatus) {
    startTransition(async () => {
      const result = await setBookingStatus({ bookingId: booking.id, status });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }
  function move(booking: BookingListItem, resourceId: string) {
    startTransition(async () => {
      const result = await assignBookingResource({ bookingId: booking.id, resourceId });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  if (!timeWindow) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        No bookings this day — the timetable draws itself once there are.
      </p>
    );
  }

  const pct = (ts: number) => ((ts - timeWindow.start) / timeWindow.span) * 100;
  const nowPct = nowTs === null ? -1 : pct(nowTs);

  // Room capacity reference for the covers meter: total seats in table
  // mode, the configured per-slot cap otherwise.
  const maxCovers = tableMode
    ? resources.filter((r) => r.active).reduce((sum, r) => sum + r.seats, 0)
    : parseServiceSchedule(service.schedule).capacityPerSlot;

  // Hour ticks across the window, labeled in the service timezone.
  const ticks: { left: number; label: string }[] = [];
  const firstHour = Math.ceil(timeWindow.start / 3_600_000) * 3_600_000;
  for (let t = firstHour; t < timeWindow.end; t += 3_600_000) {
    ticks.push({
      left: pct(t),
      label: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        timeZone: service.timezone,
      }).format(new Date(t)),
    });
  }

  return (
    <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
      <div className="min-w-[640px]">
        {/* Hour header */}
        <div className="relative ml-24 h-7 border-b border-border/60">
          {ticks.map((t) => (
            <span
              key={t.label + t.left}
              style={{ left: `${t.left}%` }}
              className="absolute top-1.5 -translate-x-1/2 text-xs text-muted-foreground tabular-nums"
            >
              {t.label}
            </span>
          ))}
        </div>

        <div className="relative">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-stretch border-b border-border/40 last:border-b-0"
            >
              <div className="w-24 shrink-0 border-r border-border/40 px-2 py-2">
                <p className={cn("truncate text-xs font-medium", row.id === "unassigned" && "text-amber-600 dark:text-amber-400")}>
                  {row.label}
                </p>
                {row.sub ? (
                  <p className="text-xs text-muted-foreground">{row.sub}</p>
                ) : null}
              </div>
              <div className="relative min-h-10 flex-1">
                {/* hour gridlines */}
                {ticks.map((t) => (
                  <span
                    key={t.left}
                    style={{ left: `${t.left}%` }}
                    className="absolute inset-y-0 border-l border-border/30"
                  />
                ))}
                {nowPct > 0 && nowPct < 100 ? (
                  <span
                    style={{ left: `${nowPct}%` }}
                    className="absolute inset-y-0 z-10 border-l-2 border-rose-500/70 shadow-[0_0_6px_rgba(244,63,94,0.5)]"
                  />
                ) : null}
                {row.bookings.map((b) => {
                  const left = pct(new Date(b.starts_at).getTime());
                  const width = Math.max(
                    3,
                    pct(new Date(b.ends_at).getTime()) - left,
                  );
                  const actions = NEXT_ACTIONS[b.status] ?? [];
                  return (
                    <DropdownMenu key={b.id}>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${b.guest_name} ×${b.party_size} · ${b.reference} · ${b.status}`}
                            className={cn(
                              "absolute top-1.5 bottom-1.5 z-[5] overflow-hidden rounded-md border px-1.5 text-left text-xs leading-tight transition-transform hover:scale-y-105",
                              STATUS_BLOCK[b.status],
                            )}
                          />
                        }
                      >
                        <span className="block truncate font-semibold">
                          {b.guest_name}
                        </span>
                        <span className="block truncate opacity-80">
                          ×{b.party_size}
                          {b.source === "chatbot" ? " · bot" : b.source === "web" ? " · web" : ""}
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {actions.map((a) => (
                          <DropdownMenuItem
                            key={a.status}
                            variant={a.status === "cancelled" ? "destructive" : undefined}
                            onClick={() => act(b, a.status)}
                          >
                            {a.label}
                          </DropdownMenuItem>
                        ))}
                        {tableMode &&
                        (b.status === "pending" || b.status === "confirmed") ? (
                          <>
                            {actions.length > 0 ? <DropdownMenuSeparator /> : null}
                            {resources
                              .filter((r) => r.active && r.id !== b.resource_id && r.seats >= b.party_size)
                              .slice(0, 8)
                              .map((r) => (
                                <DropdownMenuItem key={r.id} onClick={() => move(b, r.id)}>
                                  Move to {r.name} ({r.seats})
                                </DropdownMenuItem>
                              ))}
                          </>
                        ) : null}
                        {actions.length === 0 ? (
                          <DropdownMenuItem disabled>
                            {b.status === "completed" ? "Finished" : b.status}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Capacity meter (OpenTable's footer strip): covers in play per
              hour vs what the room can hold — gaps to squeeze turns into.
              Meaningless for rentals (units, not covers). */}
          <div
            className={cn(
              "flex items-stretch border-t border-border/60 bg-muted/20",
              service.booking_mode === "rental" && "hidden",
            )}
          >
            <div className="w-24 shrink-0 border-r border-border/40 px-2 py-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Covers / {maxCovers}
              </p>
            </div>
            <div className="relative min-h-7 flex-1">
              {ticks.map((t, i) => {
                const hourStart = firstHour + i * 3_600_000;
                const covers = dayBookings
                  .filter(
                    (b) =>
                      (b.status === "pending" ||
                        b.status === "confirmed" ||
                        b.status === "seated") &&
                      new Date(b.starts_at).getTime() < hourStart + 3_600_000 &&
                      new Date(b.ends_at).getTime() > hourStart,
                  )
                  .reduce((sum, b) => sum + b.party_size, 0);
                if (covers === 0) return null;
                const ratio = maxCovers > 0 ? covers / maxCovers : 0;
                return (
                  <span
                    key={t.left}
                    style={{ left: `${t.left}%` }}
                    className={cn(
                      "absolute top-1.5 -translate-x-1/2 rounded px-1 text-xs font-medium tabular-nums",
                      ratio >= 1
                        ? "bg-red-500/15 text-red-600 dark:text-red-400"
                        : ratio >= 0.8
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {covers}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
