"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ServiceWorkspace } from "./service-workspace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  parseServiceSchedule,
  SERVICE_KIND_META,
} from "@/lib/bookings/schema";
import type {
  BookableServiceKind,
  BookingMode,
  BookingSource,
  BookingStatus,
} from "@/lib/db/types";
import { ServiceDialog } from "./service-dialog";
import { ManualBookingDialog } from "./manual-booking-dialog";
import { FloorPlanView, type ResourceItem } from "./floor-plan";
import { Timetable } from "./timetable";
import { setBookingStatus, deleteService } from "./actions";

export type ServiceListItem = {
  id: string;
  property_id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  kind: BookableServiceKind;
  booking_mode: BookingMode;
  schedule: unknown;
  timezone: string;
  active: boolean;
  public_bookable: boolean;
};

export type BookingListItem = {
  id: string;
  service_id: string;
  reference: string;
  guest_name: string;
  guest_phone: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  notes: string | null;
  source: BookingSource;
  resource_id: string | null;
};

export function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftDate(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  return new Date(d.getTime() + days * 86400_000).toISOString().slice(0, 10);
}

export function BookingStatusBadge({
  status,
  eventKind = false,
}: {
  status: BookingStatus;
  /** Events frame "seated" as door check-in. */
  eventKind?: boolean;
}) {
  switch (status) {
    case "confirmed":
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          Confirmed
        </Badge>
      );
    case "pending":
      return (
        <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          Pending
        </Badge>
      );
    case "seated":
      return (
        <Badge className="border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400">
          {eventKind ? "Checked in" : "Seated"}
        </Badge>
      );
    case "completed":
      return <Badge variant="secondary">Completed</Badge>;
    case "no_show":
      return (
        <Badge className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
          No-show
        </Badge>
      );
    default:
      return <Badge variant="secondary">Cancelled</Badge>;
  }
}

export function BookingsView({
  propertyId,
  propertySlug = null,
  services,
  bookings,
  resources = [],
  view = "agenda",
  focusServiceId = null,
}: {
  propertyId: string;
  propertySlug?: string | null;
  services: ServiceListItem[];
  bookings: BookingListItem[];
  resources?: (ResourceItem & { id: string; service_id: string })[];
  /** Sidebar views — agenda is the day list; floor/timetable are per-service. */
  view?: "agenda" | "pending" | "services" | "floor" | "timetable";
  /** A sidebar service item was opened — show its kind-specific workspace. */
  focusServiceId?: string | null;
}) {
  const router = useRouter();
  const [day, setDay] = useState(todayKey());
  const [editingService, setEditingService] = useState<ServiceListItem | "new" | null>(
    null,
  );
  const [bookingOpen, setBookingOpen] = useState(false);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");

  // Floor view prefers table-mode services; timetable takes any.
  const floorServices = services.filter((s) => s.booking_mode === "tables");
  const focusService =
    (view === "floor" ? floorServices : services).find(
      (s) => s.id === serviceId,
    ) ??
    (view === "floor" ? floorServices[0] : services[0]) ??
    null;

  // Live agenda: bots insert bookings from guest conversations — push, not
  // polling (Supabase Realtime → server refetch).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bookings:${propertyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `property_id=eq.${propertyId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_resources",
          filter: `property_id=eq.${propertyId}`,
        },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, router]);

  const serviceById = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );
  const dayBookings = useMemo(
    () =>
      bookings
        .filter((b) => dateKey(b.starts_at) === day)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [bookings, day],
  );
  const pendingBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.status === "pending" && dateKey(b.starts_at) >= todayKey())
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [bookings],
  );
  const pendingCount = pendingBookings.length;

  // Ticket sales per event service — next upcoming date, active bookings only.
  const eventStatsByService = useMemo(() => {
    const map = new Map<string, { date: string; sold: number; capacity: number }>();
    const today = todayKey();
    for (const s of services) {
      if (s.kind !== "event") continue;
      const schedule = parseServiceSchedule(s.schedule);
      const dates = Object.keys(schedule.dates ?? {}).sort();
      const next = dates.find((d) => d >= today) ?? dates[dates.length - 1];
      if (!next) continue;
      const sold = bookings
        .filter(
          (b) =>
            b.service_id === s.id &&
            dateKey(b.starts_at) === next &&
            b.status !== "cancelled" &&
            b.status !== "no_show",
        )
        .reduce((n, b) => n + b.party_size, 0);
      map.set(s.id, { date: next, sold, capacity: schedule.capacityPerSlot });
    }
    return map;
  }, [services, bookings]);

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));

  // Sidebar service item open → that service's kind-specific workspace
  // replaces the cross-service screens entirely.
  const workspaceService = focusServiceId
    ? (services.find((s) => s.id === focusServiceId) ?? null)
    : null;

  const dialogs = (
    <>
      {editingService !== null ? (
        <ServiceDialog
          propertyId={propertyId}
          service={editingService === "new" ? null : editingService}
          onClose={() => setEditingService(null)}
          onDelete={
            editingService !== "new"
              ? async () => {
                  const result = await deleteService(editingService.id);
                  if ("error" in result) toast.error(result.error);
                  else {
                    toast.success("Service deleted");
                    router.refresh();
                  }
                  setEditingService(null);
                }
              : undefined
          }
        />
      ) : null}
      {bookingOpen ? (
        <ManualBookingDialog
          propertyId={propertyId}
          services={
            workspaceService ? [workspaceService] : services.filter((s) => s.active)
          }
          defaultDate={day}
          onClose={() => setBookingOpen(false)}
        />
      ) : null}
    </>
  );

  if (workspaceService) {
    return (
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto px-6 pt-8 pb-16 sm:px-10">
        <ServiceWorkspace
          propertyId={propertyId}
          propertySlug={propertySlug}
          service={workspaceService}
          bookings={bookings}
          resources={resources}
          onEditService={() => setEditingService(workspaceService)}
          onNewBooking={() => setBookingOpen(true)}
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto px-6 pt-8 pb-16 sm:px-10">
      {/* Compact working-tool header — this page is the property's booking
          engine, not an editorial index; height goes to the views. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bookings
          </h1>
          <p className="truncate text-[13px] text-muted-foreground">
            Tables, tickets, rentals — chatbots and walk-ins book against the
            same live availability.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {propertySlug ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                window.open(
                  `${window.location.origin}/book/${propertySlug}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              <ExternalLink data-slot="icon" />
              Public page
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setEditingService("new")}>
            <Plus data-slot="icon" />
            New service
          </Button>
          <Button size="sm" onClick={() => setBookingOpen(true)} disabled={services.length === 0}>
            <Plus data-slot="icon" />
            New booking
          </Button>
        </div>
      </header>

      <hr className="my-6 border-border" />

      {/* Services */}
      <section className={cn("space-y-3", view !== "services" && "hidden")}>
        <p className="text-sm font-medium">Services</p>
        {services.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CalendarCheck className="size-6 text-muted-foreground" />
            </span>
            <div>
              <p className="text-sm font-medium">No bookable services yet</p>
              <p className="mt-1 max-w-[44ch] text-sm text-pretty text-muted-foreground">
                Create your first — a dinner table, a massage, a sunset tour —
                then enable &ldquo;Take bookings&rdquo; on a chatbot so guests
                can book it themselves.
              </p>
            </div>
            <Button onClick={() => setEditingService("new")}>
              <Plus data-slot="icon" />
              New service
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                eventStats={eventStatsByService.get(service.id)}
                onEdit={() => setEditingService(service)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Pending — every unconfirmed future booking, the work-to-zero list. */}
      <section className={cn("space-y-3", view !== "pending" && "hidden")}>
        <p className="text-sm font-medium">Waiting on a yes</p>
        {pendingBookings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Nothing pending — every booking is confirmed.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {pendingBookings.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking}
                service={serviceById.get(booking.service_id)}
                showDate
              />
            ))}
          </ul>
        )}
      </section>

      {/* Booking-engine pulse — divider-separated stat row (lightest
          separation that works; the big number / small label contrast does
          the heavy lifting). */}
      {view === "agenda" ? (
        <div className="mb-8 grid grid-cols-2 sm:grid-cols-4">
          {(() => {
            const today = todayKey();
            const active = (b: BookingListItem) =>
              b.status === "pending" || b.status === "confirmed" || b.status === "seated";
            const todays = bookings.filter(
              (b) => dateKey(b.starts_at) === today && active(b),
            );
            const week = bookings.filter(
              (b) =>
                active(b) &&
                dateKey(b.starts_at) >= today &&
                dateKey(b.starts_at) <= shiftDate(today, 7),
            );
            const stats = [
              { label: "Bookings today", value: todays.length },
              {
                label: "Guests today",
                value: todays.reduce((sum, b) => sum + b.party_size, 0),
              },
              { label: "Pending approval", value: pendingCount, warn: pendingCount > 0 },
              { label: "Next 7 days", value: week.length },
            ];
            return stats.map((s, i) => (
              <div
                key={s.label}
                className={cn(
                  "border-foreground/10",
                  // Divider + padding choreography per breakpoint: 2-col on
                  // mobile (odd items start rows), 4-col from sm.
                  i % 2 === 1 && "border-l pl-6",
                  i % 2 === 0 && "pr-6",
                  i >= 2 && "mt-4 sm:mt-0",
                  i > 0 && "sm:border-l sm:pl-6",
                  i < 3 && "sm:pr-6",
                  i === 0 && "sm:pl-0",
                  i === 3 && "sm:pr-0",
                )}
              >
                <p
                  className={cn(
                    "text-2xl font-semibold tracking-tight tabular-nums",
                    s.warn && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {s.value}
                </p>
                <p className="truncate text-xs text-muted-foreground">{s.label}</p>
              </div>
            ));
          })()}
        </div>
      ) : null}

      {/* Day agenda + the per-day visual views (floor / timetable) share the
          date navigation. */}
      <section
        className={cn(
          "space-y-3",
          view !== "agenda" && view !== "floor" && view !== "timetable" && "hidden",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous day"
              onClick={() => setDay((d) => shiftDate(d, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <button
              type="button"
              onClick={() => setDay(todayKey())}
              className="min-w-44 text-center text-sm font-medium hover:text-foreground"
            >
              {day === todayKey() ? `Today — ${dayLabel}` : dayLabel}
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next day"
              onClick={() => setDay((d) => shiftDate(d, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {(view === "floor" || view === "timetable") && services.length > 1 ? (
              <select
                value={focusService?.id ?? ""}
                onChange={(e) => setServiceId(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                aria-label="Service"
              >
                {(view === "floor" ? floorServices : services).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji ? `${s.emoji} ` : ""}
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            {pendingCount > 0 ? (
              <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                {pendingCount} pending confirmation
              </Badge>
            ) : null}
          </div>
        </div>

        {view === "agenda" ? (
          <>
            {/* Status filter chips (resOS pattern) — work the day by state. */}
            {dayBookings.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", "All"],
                    ["pending", "Pending"],
                    ["confirmed", "Confirmed"],
                    ["seated", "Seated"],
                    ["completed", "Done"],
                  ] as const
                ).map(([value, label]) => {
                  const count =
                    value === "all"
                      ? dayBookings.length
                      : dayBookings.filter((b) => b.status === value).length;
                  // Zero-count chips stay (disabled) so the row doesn't reflow
                  // as statuses change under Realtime.
                  const empty = value !== "all" && count === 0;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={statusFilter === value}
                      disabled={empty}
                      onClick={() => setStatusFilter(value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        statusFilter === value
                          ? "border-foreground/40 bg-foreground/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                        empty && "opacity-40 hover:text-muted-foreground",
                      )}
                    >
                      {label}
                      <span className="ml-1 tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {dayBookings.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                No bookings this day.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {dayBookings
                  .filter((b) => statusFilter === "all" || b.status === statusFilter)
                  .map((booking) => (
                    <BookingRow
                      key={booking.id}
                      booking={booking}
                      service={serviceById.get(booking.service_id)}
                    />
                  ))}
              </ul>
            )}
          </>
        ) : null}

        {view === "floor" ? (
          focusService ? (
            <FloorPlanView
              key={focusService.id}
              propertyId={propertyId}
              service={focusService}
              resources={resources.filter((r) => r.service_id === focusService.id)}
              bookings={bookings}
              day={day}
            />
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                <LayoutGrid className="size-6 text-muted-foreground" />
              </span>
              <div>
                <p className="text-sm font-medium">No floor plan yet</p>
                <p className="mt-1 max-w-[46ch] text-sm text-pretty text-muted-foreground">
                  A floor plan belongs to a service whose booking mode is
                  &ldquo;Tables &amp; floor plan&rdquo; — create one (or edit
                  an existing service), then come back here to lay out the
                  room.
                </p>
              </div>
              <Button onClick={() => setEditingService("new")}>
                <Plus data-slot="icon" />
                New table service
              </Button>
            </div>
          )
        ) : null}

        {view === "timetable" ? (
          focusService ? (
            <>
              <Timetable
                key={focusService.id}
                service={focusService}
                resources={resources.filter((r) => r.service_id === focusService.id)}
                bookings={bookings}
                day={day}
              />
              <p className="text-xs text-muted-foreground md:hidden">
                The timetable is a desktop tool — use the Agenda list here.
              </p>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              Create a service first.
            </p>
          )
        ) : null}
      </section>

      {dialogs}
    </div>
  );
}

function ServiceCard({
  service,
  eventStats,
  onEdit,
}: {
  service: ServiceListItem;
  /** Events: next occurrence's ticket sales for the sold/capacity meter. */
  eventStats?: { date: string; sold: number; capacity: number };
  onEdit: () => void;
}) {
  const schedule = parseServiceSchedule(service.schedule);
  const meta = SERVICE_KIND_META[service.kind];
  const soldPct = eventStats
    ? Math.min(100, Math.round((eventStats.sold / Math.max(1, eventStats.capacity)) * 100))
    : 0;
  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex flex-col gap-2 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-base">
          {service.emoji || meta.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{service.name}</p>
          <p className="truncate text-xs text-muted-foreground">{meta.label}</p>
        </div>
        {!service.active ? <Badge variant="secondary">Paused</Badge> : null}
      </div>
      {eventStats ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {new Intl.DateTimeFormat("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${eventStats.date}T00:00:00Z`))}{" "}
            ·{" "}
            <span className="font-medium text-foreground">
              {eventStats.sold}/{eventStats.capacity}
            </span>{" "}
            tickets
          </p>
          <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full rounded-full",
                soldPct >= 100
                  ? "bg-red-500"
                  : soldPct >= 80
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
              style={{ width: `${soldPct}%` }}
            />
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {schedule.durationMinutes} min ·{" "}
          {schedule.countPartySize
            ? `${schedule.capacityPerSlot} ${service.kind === "tour" ? "seats" : "covers"}/slot`
            : `${schedule.capacityPerSlot} concurrent`}{" "}
          · every {schedule.slotIntervalMinutes} min
        </p>
      )}
    </button>
  );
}

export function BookingRow({
  booking,
  service,
  showDate = false,
}: {
  booking: BookingListItem;
  service: ServiceListItem | undefined;
  /** Cross-day lists (Pending) show the date next to the time. */
  showDate?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const time = new Intl.DateTimeFormat("en-US", {
    ...(showDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone: service?.timezone ?? "UTC",
  }).format(new Date(booking.starts_at));

  const actions: { label: string; status: BookingStatus }[] =
    booking.status === "pending"
      ? [
          { label: "Confirm", status: "confirmed" },
          { label: "Cancel", status: "cancelled" },
        ]
      : booking.status === "confirmed"
        ? [
            // Events frame "seated" as door check-in.
            {
              label: service?.kind === "event" ? "Check in" : "Seat",
              status: "seated" as const,
            },
            { label: "Complete", status: "completed" },
            { label: "No-show", status: "no_show" },
            { label: "Cancel", status: "cancelled" },
          ]
        : booking.status === "seated"
          ? [{ label: "Finish", status: "completed" }]
          : [];

  function move(status: BookingStatus) {
    startTransition(async () => {
      const result = await setBookingStatus({ bookingId: booking.id, status });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  const terminal = booking.status === "cancelled" || booking.status === "no_show";

  // Status carried as a left accent (the Fresha/resOS color block, dialed
  // down to a 2px rule so the list stays calm).
  const accent: Record<BookingStatus, string> = {
    pending: "border-l-amber-500",
    confirmed: "border-l-blue-500",
    seated: "border-l-violet-500",
    completed: "border-l-border",
    cancelled: "border-l-border",
    no_show: "border-l-red-400",
  };

  return (
    <li
      className={cn(
        "flex items-center gap-3 border-l-2 px-4 py-3",
        accent[booking.status],
        terminal && "opacity-60",
      )}
    >
      <span
        className={cn(
          "shrink-0 text-sm font-medium tabular-nums",
          showDate ? "w-32" : "w-16",
        )}
      >
        {time}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {booking.guest_name}
          <span className="text-muted-foreground">
            {" "}
            ·{" "}
            {service?.kind === "event"
              ? `${booking.party_size} ticket${booking.party_size === 1 ? "" : "s"}`
              : `party of ${booking.party_size}`}
            {booking.guest_phone ? ` · ${booking.guest_phone}` : ""}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {service ? `${service.emoji || ""} ${service.name}`.trim() : "Service"} ·{" "}
          {booking.reference}
          {booking.source === "chatbot" ? " · via chatbot" : booking.source === "web" ? " · booked online" : ""}
          {booking.notes ? ` · ${booking.notes}` : ""}
        </p>
      </div>
      <BookingStatusBadge
        status={booking.status}
        eventKind={service?.kind === "event"}
      />
      {actions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Booking actions"
                disabled={pending}
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.map((a) => (
              <DropdownMenuItem
                key={a.status}
                variant={a.status === "cancelled" ? "destructive" : undefined}
                onClick={() => move(a.status)}
              >
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}
