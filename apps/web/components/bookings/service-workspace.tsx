"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Palette,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { SectionHeader } from "@/components/ui/section-header";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseServiceSchedule } from "@/lib/bookings/schema";
import type { BookingStatus } from "@/lib/db/types";
import {
  BookingRow,
  BookingStatusBadge,
  dateKey,
  shiftDate,
  todayKey,
  type BookingListItem,
  type ServiceListItem,
} from "./bookings-view";
import { FloorPlanView, type ResourceItem } from "./floor-plan";
import { Timetable } from "./timetable";
import { EventPageDialog } from "./event-page-dialog";
import { setBookingStatus } from "./actions";

/**
 * The per-service workspace — what the sidebar's service items open. The
 * service's KIND decides the UI: a restaurant is reservations + floor plan +
 * timetable, an event is ticketing with a door list, a rental is a units
 * schedule, a spa or tour is a day sheet of appointments. One booking
 * engine underneath; the workspace is the vocabulary on top.
 */
export function ServiceWorkspace({
  propertyId,
  propertySlug,
  service,
  bookings,
  resources,
  onEditService,
  onNewBooking,
}: {
  propertyId: string;
  propertySlug?: string | null;
  service: ServiceListItem;
  bookings: BookingListItem[];
  resources: (ResourceItem & { id: string; service_id: string })[];
  onEditService: () => void;
  onNewBooking: () => void;
}) {
  const schedule = parseServiceSchedule(service.schedule);
  const [pageDialogOpen, setPageDialogOpen] = useState(false);
  const scoped = useMemo(
    () => bookings.filter((b) => b.service_id === service.id),
    [bookings, service.id],
  );
  const isEvent = service.kind === "event";
  const tableMode = service.booking_mode === "tables";
  const rentalMode = service.booking_mode === "rental";

  const kindNoun = isEvent
    ? "Ticketing"
    : tableMode
      ? "Reservations"
      : rentalMode
        ? "Rentals"
        : "Appointments";

  return (
    <div className="space-y-4">
      {/* Same masthead tier as every other index page (`ui/section-header`
          size="page" — 40/48 weight 700, no rule). */}
      <SectionHeader
        size="page"
        className="mb-10 flex-wrap gap-y-3"
        title={`${service.emoji ? `${service.emoji} ` : ""}${service.name}`}
        description={`${kindNoun}${
          schedule.priceLabel ? ` · ${schedule.priceLabel}` : ""
        }${!service.active ? " · paused" : ""}`}
        actions={
          <>
            {propertySlug && service.public_bookable ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Events get their own Luma-style landing page; everything
                  // else shares the property wizard.
                  const url = isEvent
                    ? `${window.location.origin}/book/${propertySlug}/event/${service.id}`
                    : `${window.location.origin}/book/${propertySlug}`;
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink data-slot="icon" />
                {isEvent ? "Ticket page" : "Public page"}
              </Button>
            ) : null}
            {isEvent ? (
              <Button variant="outline" size="sm" onClick={() => setPageDialogOpen(true)}>
                <Palette data-slot="icon" />
                Customize page
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={onEditService}>
              <Pencil data-slot="icon" />
              Edit service
            </Button>
            <Button size="sm" onClick={onNewBooking}>
              <Plus data-slot="icon" />
              {isEvent ? "Sell tickets" : "New booking"}
            </Button>
          </>
        }
      />

      {isEvent ? (
        <TicketingView bookings={scoped} schedule={schedule} />
      ) : tableMode ? (
        <TableServiceView
          propertyId={propertyId}
          service={service}
          bookings={scoped}
          resources={resources}
        />
      ) : (
        <DaySheetView
          service={service}
          bookings={scoped}
          resources={resources}
          rentalMode={rentalMode}
        />
      )}

      {pageDialogOpen ? (
        <EventPageDialog
          service={service}
          propertySlug={propertySlug}
          onClose={() => setPageDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared day navigation
// ---------------------------------------------------------------------------

function DayNav({ day, onChange }: { day: string; onChange: (d: string) => void }) {
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous day"
        onClick={() => onChange(shiftDate(day, -1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <button
        type="button"
        onClick={() => onChange(todayKey())}
        className="h-7 min-w-44 rounded-md px-2 text-center text-sm font-medium transition-colors hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
      >
        {day === todayKey() ? `Today — ${label}` : label}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next day"
        onClick={() => onChange(shiftDate(day, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

/** Day agenda scoped to one service, with the status-chip filter. */
function ScopedAgenda({
  service,
  bookings,
  day,
}: {
  service: ServiceListItem;
  bookings: BookingListItem[];
  day: string;
}) {
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");
  const dayBookings = useMemo(
    () =>
      bookings
        .filter((b) => dateKey(b.starts_at) === day)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [bookings, day],
  );

  if (dayBookings.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nothing booked this day.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", "All"],
            ["pending", "Pending"],
            ["confirmed", "Confirmed"],
            ["seated", service.kind === "event" ? "Checked in" : "Seated"],
            ["completed", "Done"],
          ] as const
        ).map(([value, label]) => {
          const count =
            value === "all"
              ? dayBookings.length
              : dayBookings.filter((b) => b.status === value).length;
          const empty = value !== "all" && count === 0;
          return (
            <Chip
              key={value}
              size="sm"
              selected={statusFilter === value}
              disabled={empty}
              onClick={() => setStatusFilter(value)}
              className={cn(empty && "opacity-40")}
            >
              {label}
              <span className="tabular-nums opacity-70">{count}</span>
            </Chip>
          );
        })}
      </div>
      <ul role="list" className="-mx-2 flex flex-col divide-y divide-border">
        {dayBookings
          .filter((b) => statusFilter === "all" || b.status === statusFilter)
          .map((booking) => (
            <BookingRow key={booking.id} booking={booking} service={service} />
          ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables (restaurant): Reservations · Floor plan · Timetable
// ---------------------------------------------------------------------------

function TableServiceView({
  propertyId,
  service,
  bookings,
  resources,
}: {
  propertyId: string;
  service: ServiceListItem;
  bookings: BookingListItem[];
  resources: (ResourceItem & { id: string; service_id: string })[];
}) {
  const [tab, setTab] = useState<"reservations" | "floor" | "timetable">(
    "reservations",
  );
  const [day, setDay] = useState(todayKey());
  const own = resources.filter((r) => r.service_id === service.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabNav variant="pill" aria-label="View">
          {(
            [
              ["reservations", "Reservations"],
              ["floor", "Floor plan"],
              ["timetable", "Timetable"],
            ] as const
          ).map(([id, label]) => (
            <TabNavItem key={id} active={tab === id} onClick={() => setTab(id)}>
              {label}
            </TabNavItem>
          ))}
        </TabNav>
        <DayNav day={day} onChange={setDay} />
      </div>

      {tab === "reservations" ? (
        <ScopedAgenda service={service} bookings={bookings} day={day} />
      ) : tab === "floor" ? (
        <FloorPlanView
          propertyId={propertyId}
          service={service}
          resources={own}
          bookings={bookings}
          day={day}
        />
      ) : (
        <>
          <Timetable service={service} resources={own} bookings={bookings} day={day} />
          <p className="text-xs text-muted-foreground md:hidden">
            The timetable is a desktop tool — use Reservations here.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events: ticketing — date picker, sales meter, door list with check-in
// ---------------------------------------------------------------------------

function TicketingView({
  bookings,
  schedule,
}: {
  bookings: BookingListItem[];
  schedule: ReturnType<typeof parseServiceSchedule>;
}) {
  const dates = useMemo(
    () => Object.keys(schedule.dates ?? {}).sort(),
    [schedule.dates],
  );
  const defaultDate =
    dates.find((d) => d >= todayKey()) ?? dates[dates.length - 1] ?? todayKey();
  const [date, setDate] = useState(defaultDate);
  const [query, setQuery] = useState("");

  const dayBookings = useMemo(
    () =>
      bookings
        .filter((b) => dateKey(b.starts_at) === date)
        .sort((a, b) => a.guest_name.localeCompare(b.guest_name)),
    [bookings, date],
  );
  const active = dayBookings.filter(
    (b) => b.status !== "cancelled" && b.status !== "no_show",
  );
  const sold = active.reduce((n, b) => n + b.party_size, 0);
  const checkedIn = active
    .filter((b) => b.status === "seated" || b.status === "completed")
    .reduce((n, b) => n + b.party_size, 0);
  const capacity = schedule.capacityPerSlot;
  const soldPct = Math.min(100, Math.round((sold / Math.max(1, capacity)) * 100));

  const visible = query.trim()
    ? dayBookings.filter(
        (b) =>
          b.guest_name.toLowerCase().includes(query.trim().toLowerCase()) ||
          b.reference.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : dayBookings;

  return (
    <div className="space-y-4">
      {dates.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <Chip key={d} size="sm" selected={date === d} onClick={() => setDate(d)}>
              {new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(`${d}T00:00:00Z`))}
            </Chip>
          ))}
        </div>
      ) : null}

      {/* Sales + door pulse — a warm well, not a bordered card. */}
      <div className="space-y-2 rounded-md bg-muted px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">
              {sold}
            </span>
            <span className="text-muted-foreground"> / {capacity} tickets</span>
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              {checkedIn}
            </span>{" "}
            checked in at the door
          </p>
        </div>
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full",
              soldPct >= 100
                ? "bg-destructive"
                : soldPct >= 80
                  ? "bg-warning"
                  : "bg-success",
            )}
            style={{ width: `${soldPct}%` }}
          />
        </span>
      </div>

      {/* Door list — alphabetical, searchable, one-tap check-in. */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a name or reference…"
            className="pl-7"
            aria-label="Search the door list"
          />
        </div>
        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {dayBookings.length === 0
              ? "No tickets reserved for this date yet."
              : "Nobody matches that search."}
          </p>
        ) : (
          <ul role="list" className="-mx-2 flex flex-col divide-y divide-border">
            {visible.map((b) => (
              <DoorRow key={b.id} booking={b} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One ticket holder on the door list. The big action is Check in. */
function DoorRow({ booking }: { booking: BookingListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const terminal =
    booking.status === "cancelled" || booking.status === "no_show";

  function move(status: BookingStatus) {
    startTransition(async () => {
      const result = await setBookingStatus({ bookingId: booking.id, status });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <li
      className={cn(
        // Same 34px/6px data row as the agenda and every other list surface.
        "flex min-h-[34px] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent",
        terminal && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {booking.guest_name}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {booking.party_size} ticket{booking.party_size === 1 ? "" : "s"}
          </span>
        </p>
        <p className="truncate font-mono text-xs text-faint-foreground">
          {booking.reference}
          {booking.guest_phone ? ` · ${booking.guest_phone}` : ""}
        </p>
      </div>
      <BookingStatusBadge status={booking.status} eventKind />
      {booking.status === "pending" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => move("confirmed")}
        >
          Confirm
        </Button>
      ) : booking.status === "confirmed" ? (
        <Button size="sm" disabled={pending} onClick={() => move("seated")}>
          Check in
        </Button>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Capacity + rental: day sheet (rentals add the units timetable)
// ---------------------------------------------------------------------------

function DaySheetView({
  service,
  bookings,
  resources,
  rentalMode,
}: {
  service: ServiceListItem;
  bookings: BookingListItem[];
  resources: (ResourceItem & { id: string; service_id: string })[];
  rentalMode: boolean;
}) {
  const [day, setDay] = useState(todayKey());
  const own = resources.filter((r) => r.service_id === service.id);

  // "Now" captured post-mount — render stays pure for the compiler.
  const [nowTs, setNowTs] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNowTs(Date.now()), []);

  // Rentals: what's out right now, across days (a 24h hire started yesterday
  // still matters today).
  const outNow =
    rentalMode && nowTs !== null
      ? bookings.filter(
          (b) =>
            (b.status === "seated" || b.status === "confirmed") &&
            new Date(b.starts_at).getTime() <= nowTs &&
            nowTs < new Date(b.ends_at).getTime(),
        ).length
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayNav day={day} onChange={setDay} />
        {rentalMode && outNow > 0 ? (
          <StatusBadge tone="violet" dot={false}>
            {outNow} out now
          </StatusBadge>
        ) : null}
      </div>
      {rentalMode && own.length > 0 ? (
        <>
          <Timetable service={service} resources={own} bookings={bookings} day={day} />
          <p className="text-xs text-muted-foreground md:hidden">
            The unit schedule is a desktop tool — the list below has everything.
          </p>
        </>
      ) : null}
      <ScopedAgenda service={service} bookings={bookings} day={day} />
    </div>
  );
}
