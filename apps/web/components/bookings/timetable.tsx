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
 * status actions and table re-assignment; the accent rule marks "now".
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
      <p className="py-10 text-center text-sm text-muted-foreground">
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
    // A data view: full bleed inside its section, capped only by the
    // horizontal scroller. The frame is a SURFACE, so it takes the 10px rung
    // with the bare warm ring — it is not a page, so no `shadow-card`.
    <div className="hidden overflow-x-auto rounded-card shadow-ring md:block">
      {/* Wider minimum than before: the resource column grew to hold a 14px
          table name, and the blocks need room for a 14px guest name. */}
      <div className="min-w-[720px]">
        {/* Hour header — axis ticks are metadata, so they stay on 12px. */}
        <div className="relative ml-28 h-7 border-b border-border">
          {ticks.map((t) => (
            <span
              key={t.label + t.left}
              style={{ left: `${t.left}%` }}
              className="absolute top-1.5 -translate-x-1/2 text-xs font-medium text-faint-foreground tabular-nums"
            >
              {t.label}
            </span>
          ))}
        </div>

        <div className="relative">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-stretch border-b border-border last:border-b-0"
            >
              {/* A table/unit name is a row LABEL — the same 14px/500 rung as
                  every other list row in the app. The seat count under it is
                  the secondary annotation and stays 12px faint. */}
              <div className="w-28 shrink-0 border-r border-border px-2 py-2">
                <p
                  className={cn(
                    "truncate text-sm leading-tight font-medium",
                    row.id === "unassigned" && "text-warning",
                  )}
                >
                  {row.label}
                </p>
                {row.sub ? (
                  <p className="truncate text-xs leading-tight text-faint-foreground">
                    {row.sub}
                  </p>
                ) : null}
              </div>
              {/* Lanes grew from 40px to 48px: a block now carries a 14px name
                  over a 12px annotation, which does not fit in 40. */}
              <div className="relative min-h-12 flex-1">
                {/* hour gridlines */}
                {ticks.map((t) => (
                  <span
                    key={t.left}
                    style={{ left: `${t.left}%` }}
                    className="absolute inset-y-0 border-l border-border"
                  />
                ))}
                {nowPct > 0 && nowPct < 100 ? (
                  // The now-rule: a true 1px hairline like every other line on
                  // the grid — it separates itself by carrying the house accent,
                  // not by being twice as thick.
                  <span
                    style={{ left: `${nowPct}%` }}
                    className="absolute inset-y-0 z-10 border-l border-accent-red"
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
                              // Tinted fill only — no stroke, no scale-lift
                              // (notion-spec §5/§6). The status tint IS the
                              // background, so hover can't be `hover:bg-accent`
                              // on the block itself without erasing the status;
                              // it's an inset warm-black overlay instead, which
                              // is the same 5% fill gesture, layered.
                              // 4px pill rung: a block is a status pill
                              // stretched along the time axis, exactly like a
                              // calendar event chip (notion-spec-v2 §4).
                              "group absolute top-1 bottom-1 z-[5] flex flex-col justify-center overflow-hidden rounded-pill px-1.5 text-left focus-visible:shadow-focus focus-visible:outline-none",
                              STATUS_BLOCK[b.status],
                            )}
                          />
                        }
                      >
                        <span className="pointer-events-none absolute inset-0 rounded-pill transition-colors group-hover:bg-accent" />
                        {/* The guest is the content: 14px/500, same rung as a
                            list row. Party size + source are the annotation. */}
                        <span className="relative block truncate text-sm leading-tight font-medium">
                          {b.guest_name}
                        </span>
                        <span className="relative block truncate text-xs leading-tight opacity-80">
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
              "flex items-stretch border-t border-border bg-muted",
              service.booking_mode === "rental" && "hidden",
            )}
          >
            <div className="w-28 shrink-0 border-r border-border px-2 py-1.5">
              <p className="text-xs leading-3 font-medium text-faint-foreground">
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
                      // An over-capacity hour is a STATE, so it is the pill:
                      // 4px radius and a `--pill-*` token PAIR rather than
                      // `/12` alpha maths over the ramp (notion-spec-v2 §6).
                      "absolute top-1.5 -translate-x-1/2 rounded-pill px-1.5 text-xs font-medium tabular-nums",
                      ratio >= 1
                        ? "bg-pill-danger text-pill-danger-ink"
                        : ratio >= 0.8
                          ? "bg-pill-warning text-pill-warning-ink"
                          : "text-faint-foreground",
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
