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
import { Chip } from "@/components/ui/chip";
import { StatCard, StatCardPill } from "@/components/ui/stat-card";
import { CoverCard, type COVER_TINTS } from "@/components/ui/cover-card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { BOOKING_STATUS_UI } from "@/lib/bookings/status-colors";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { PageShell } from "@/components/ui/page-shell";

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
        <Badge className={BOOKING_STATUS_UI.confirmed.badge}>Confirmed</Badge>
      );
    case "pending":
      return <Badge className={BOOKING_STATUS_UI.pending.badge}>Pending</Badge>;
    case "seated":
      return (
        <Badge className={BOOKING_STATUS_UI.seated.badge}>
          {eventKind ? "Checked in" : "Seated"}
        </Badge>
      );
    case "completed":
      return <Badge variant="secondary">Completed</Badge>;
    case "no_show":
      return (
        <Badge className={BOOKING_STATUS_UI.no_show.badge}>No-show</Badge>
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
      .channel(`bookings:${propertyId}:${Math.random().toString(36).slice(2)}`)
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
      <div className="flex h-full w-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
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

  // ONE width for the whole screen, masthead included (`ui/page-shell`). The
  // floor plan and the timetable ARE the data canvas and take the pane; the
  // agenda / pending / services screens are lists and sit in the 960px page
  // column. Nothing inside the shell re-caps its own width.
  const shellWidth = view === "floor" || view === "timetable" ? "bleed" : "page";

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <PageShell width={shellWidth}>
      {/* Masthead — the same page tier every other index uses (`ui/section-header`
          size="page": 40/48 weight 700, no rule under it; header and content
          separate by whitespace, docs/notion-spec.md §1/§3). */}
      <SectionHeader
        size="page"
        className="mb-14 flex-wrap gap-y-3"
        title="Bookings"
        description="Tables, tickets, rentals — chatbots and walk-ins book against the same live availability."
        actions={
          <>
            <AutomationsButton propertyId={propertyId} feature="bookings" />
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
          </>
        }
      />

      {/* Services */}
      <section className={cn("space-y-4", view !== "services" && "hidden")}>
        <h2 className="text-2xl leading-[1.3] font-semibold text-balance text-foreground">
          Services
        </h2>
        {services.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="No bookable services yet"
            action={
              <Button onClick={() => setEditingService("new")}>
                <Plus data-slot="icon" />
                New service
              </Button>
            }
          >
            Create your first — a dinner table, a massage, a sunset tour —
            then enable &ldquo;Take bookings&rdquo; on a chatbot so guests can
            book it themselves.
          </EmptyState>
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
      <section className={cn("space-y-4", view !== "pending" && "hidden")}>
        <h2 className="text-2xl leading-[1.3] font-semibold text-balance text-foreground">
          Waiting on a yes
        </h2>
        {pendingBookings.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing pending — every booking is confirmed.
          </p>
        ) : (
          <ul role="list" className="-mx-2 flex flex-col divide-y divide-border">
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

      {/* Booking-engine pulse — page-headline stat cards (ui/stat-card, the
          Claude-dashboard tier). */}
      {view === "agenda" ? (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
            return stats.map((s) => (
              <StatCard
                key={s.label}
                label={s.label}
                value={s.value}
                pill={
                  s.warn ? (
                    <StatCardPill tone="warning">Needs a yes</StatCardPill>
                  ) : undefined
                }
              />
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
        {/* The day toolbar shares the page's one edge — the shell above owns
            the width, so this never re-centres itself. */}
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
              className="h-7 min-w-44 rounded-md px-2 text-center text-sm font-medium transition-colors hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
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
              <NativeSelect
                value={focusService?.id ?? ""}
                onChange={(e) => setServiceId(e.target.value)}
                wrapperClassName="w-auto"
                aria-label="Service"
              >
                {(view === "floor" ? floorServices : services).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji ? `${s.emoji} ` : ""}
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {pendingCount > 0 ? (
              <StatusBadge tone="warning" dot={false}>
                {pendingCount} pending confirmation
              </StatusBadge>
            ) : null}
          </div>
        </div>

        {view === "agenda" ? (
          <div className="space-y-3">
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
            ) : null}
            {dayBookings.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No bookings this day.
              </p>
            ) : (
              <ul role="list" className="-mx-2 flex flex-col divide-y divide-border">
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
          </div>
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
            <EmptyState
              icon={LayoutGrid}
              title="No floor plan yet"
              action={
                <Button onClick={() => setEditingService("new")}>
                  <Plus data-slot="icon" />
                  New table service
                </Button>
              }
            >
              A floor plan belongs to a service whose booking mode is
              &ldquo;Tables &amp; floor plan&rdquo; — create one (or edit an
              existing service), then come back here to lay out the room.
            </EmptyState>
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
            <p className="py-10 text-center text-sm text-muted-foreground">
              Create a service first.
            </p>
          )
        ) : null}
      </section>
      </PageShell>

      {dialogs}
    </div>
  );
}

/** Cover tint per service kind (decorative, matches the kind's vibe). */
const SERVICE_KIND_TINTS: Partial<
  Record<string, keyof typeof COVER_TINTS>
> = {
  table: "coral",
  appointment: "sage",
  tour: "blue",
  event: "violet",
  rental: "amber",
  other: "cream",
};

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
    <CoverCard
      render={<button type="button" onClick={onEdit} />}
      tint={SERVICE_KIND_TINTS[service.kind] ?? "cream"}
      glyph={service.emoji || meta.emoji}
      title={service.name}
      titleMeta={!service.active ? <Badge variant="secondary">Paused</Badge> : null}
      tags={[meta.label]}
      className="h-full"
    >
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
                  ? "bg-destructive"
                  : soldPct >= 80
                    ? "bg-warning"
                    : "bg-success",
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
    </CoverCard>
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

  return (
    <li
      className={cn(
        // The measured 37px database row (notion-spec-v2 §6). The 2px coloured
        // left accent is GONE: it is a visible stroke carrying information the
        // `BookingStatusBadge` on the same row already carries, and a tinted
        // rule down the side of every row is the generic-dashboard tell §1
        // forbids. Hover is a fill, nothing else.
        "flex min-h-[37px] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent",
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
        <p className="truncate text-sm font-medium">
          {booking.guest_name}
          <span className="font-normal text-muted-foreground">
            {" "}
            ·{" "}
            {service?.kind === "event"
              ? `${booking.party_size} ticket${booking.party_size === 1 ? "" : "s"}`
              : `party of ${booking.party_size}`}
            {booking.guest_phone ? ` · ${booking.guest_phone}` : ""}
          </span>
        </p>
        {/* Second line is METADATA — 12px faint, the metadata rung of the
            type ramp (notion-spec-v2 §2). At 14px it competed with the name
            cell above it and the row read as two equal lines. */}
        <p className="truncate text-xs text-faint-foreground">
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
