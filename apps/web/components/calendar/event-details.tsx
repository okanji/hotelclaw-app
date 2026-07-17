"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { eventSwatch } from "@/lib/calendar/event-visuals";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlignLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleDashed,
  Clock,
  ExternalLink,
  HelpCircle,
  MapPin,
  Pencil,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { useMeeting } from "@/lib/stream/meeting-context";
import { respondToMeeting, unscheduleTask } from "@/lib/calendar/actions";
import { PRIORITY_META } from "@/components/tasks/kanban";
import type {
  AttendeeResponse,
  BookingEvent,
  CalendarEvent,
  MeetingEvent,
  TaskEvent,
  ExternalEvent,
} from "@/lib/calendar/types";
import type { MeetingRecurrence } from "@/lib/db/types";

/**
 * Google Calendar-style event details — the first thing a click on a grid
 * event opens. Anatomy mirrors GC's popover: colour chip + title, a human
 * "when" line with recurrence, a Join CTA when a video call is attached,
 * location/description rows, the guest list with RSVP states, and a
 * "Going?" bar for invited users. Editing lives behind the pencil icon
 * (`onEdit` flips the parent dialog to the form view).
 */

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "Thursday, June 11 ⋅ 1:15 – 2:15 PM" / "Thursday, June 11" (all-day). */
export function formatWhen(event: CalendarEvent): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (event.all_day) return dayLabel(start);
  if (sameDay(start, end)) {
    return `${dayLabel(start)} ⋅ ${timeLabel(start)} – ${timeLabel(end)}`;
  }
  return `${dayLabel(start)}, ${timeLabel(start)} – ${dayLabel(end)}, ${timeLabel(end)}`;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function recurrenceLabel(
  r: MeetingRecurrence | null,
  start: Date,
): string | null {
  if (!r) return null;
  if (r.frequency === "daily") return "Repeats daily";
  if (r.frequency === "weekly") {
    if (r.byday && r.byday.length === 5) return "Repeats every weekday";
    return `Repeats weekly on ${WEEKDAY_NAMES[start.getDay()]}`;
  }
  if (r.frequency === "monthly") return "Repeats monthly";
  return "Repeats";
}



// ---------------------------------------------------------------------------
// Shared scaffolding
// ---------------------------------------------------------------------------

/** Icon-gutter row — micro icon aligned with the first text line. */
function DetailRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

/**
 * The element used for the details title. Defaults to `DialogTitle` (the
 * details panel's original home was a modal). Rendered inside a non-modal
 * popover — where there is no Dialog to register a title id — the popover
 * overrides this with a plain `h2` via the provider so base-ui doesn't throw.
 */
export const DetailsTitleContext = createContext<React.ElementType>(DialogTitle);

function DetailsHeader({
  event,
  subtitle,
  actions,
}: {
  event: CalendarEvent;
  subtitle?: string | null;
  actions?: React.ReactNode;
}) {
  const TitleEl = useContext(DetailsTitleContext);
  return (
    <div className="flex items-start justify-between gap-2 pr-7">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 size-3.5 shrink-0 rounded-[4px]"
          style={{ backgroundColor: eventSwatch(event) }}
        />
        <div className="min-w-0">
          <TitleEl className="text-lg font-semibold tracking-tight text-balance">
            {event.title}
          </TitleEl>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatWhen(event)}
          </p>
          {subtitle ? (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      ) : null}
    </div>
  );
}

const RESPONSE_META: Record<
  AttendeeResponse,
  { label: string; icon: React.ReactNode; className: string }
> = {
  accepted: {
    label: "Yes",
    icon: <Check className="size-3" />,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  declined: {
    label: "No",
    icon: <X className="size-3" />,
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  tentative: {
    label: "Maybe",
    icon: <HelpCircle className="size-3" />,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  pending: {
    label: "Awaiting",
    icon: <CircleDashed className="size-3" />,
    className: "bg-muted text-muted-foreground",
  },
};

// ---------------------------------------------------------------------------
// Meeting details
// ---------------------------------------------------------------------------

export function MeetingDetails({
  event,
  propertyId,
  currentUserId,
  onEdit,
  onDelete,
  onClose,
  onMutated,
  deletePending,
}: {
  event: MeetingEvent;
  propertyId: string;
  currentUserId: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onMutated?: () => void;
  deletePending: boolean;
}) {
  const { startScheduled, videoReady } = useMeeting();
  const qc = useQueryClient();
  const [rsvpPending, startRsvp] = useTransition();

  const baseMeetingId = event.id.split("@")[0];
  const hasVideo = event.stream_call_type === "default";
  const callEnded = event.ended_at != null;

  const me = event.attendees.find((a) => a.user_id === currentUserId);
  // Optimistic local copy of my RSVP so the bar updates instantly; the
  // calendar query refetch reconciles afterwards.
  const [myResponse, setMyResponse] = useState<AttendeeResponse | null>(
    me?.response ?? null,
  );

  // The organizer is the meeting's host (fixed at creation). host_id is
  // the source of truth; the per-row is_organizer flag is only a fallback
  // for legacy rows written before host_id existed — older saves could
  // mislabel whoever last edited as the organizer.
  const isOrganizer = (a: MeetingEvent["attendees"][number]) =>
    event.host_id ? a.user_id === event.host_id : a.is_organizer;
  const iAmOrganizer = me ? isOrganizer(me) : false;

  // Effective response folds in the optimistic local RSVP so the summary
  // counts and the row badge agree before the refetch lands.
  const effectiveResponse = (a: MeetingEvent["attendees"][number]) =>
    a.user_id === currentUserId && myResponse ? myResponse : a.response;
  const accepted = event.attendees.filter(
    (a) => isOrganizer(a) || effectiveResponse(a) === "accepted",
  ).length;
  const awaiting = event.attendees.filter(
    (a) => !isOrganizer(a) && effectiveResponse(a) === "pending",
  ).length;

  function rsvp(response: "accepted" | "declined" | "tentative") {
    const prev = myResponse;
    setMyResponse(response);
    startRsvp(async () => {
      const r = await respondToMeeting({
        propertyId,
        meetingId: baseMeetingId,
        response,
      });
      if ("error" in r) {
        setMyResponse(prev);
        toast.error(r.error);
        return;
      }
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      onMutated?.();
    });
  }

  async function joinCall() {
    onClose();
    await startScheduled({
      meetingId: baseMeetingId,
      callId: event.stream_call_id,
      callType: event.stream_call_type,
    });
  }

  return (
    <div className="space-y-4">
      <DetailsHeader
        event={event}
        subtitle={recurrenceLabel(event.recurrence, new Date(event.start))}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label="Edit event"
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              disabled={deletePending}
              aria-label="Delete event"
            >
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      />

      <div className="space-y-3">
        {hasVideo ? (
          <DetailRow icon={<Video />}>
            {callEnded ? (
              <p className="text-muted-foreground">
                Video call ended
                {event.ended_at
                  ? ` · ${timeLabel(new Date(event.ended_at))}`
                  : ""}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={joinCall}
                  disabled={!videoReady}
                >
                  <Video className="size-4" />
                  Join video call
                </Button>
                <span className="text-xs text-muted-foreground">
                  {event.started_at
                    ? "In progress — others may already be in"
                    : "Camera preview before you join"}
                </span>
              </div>
            )}
          </DetailRow>
        ) : null}

        {event.location ? (
          <DetailRow icon={<MapPin />}>
            <p className="text-foreground/90">{event.location}</p>
          </DetailRow>
        ) : null}

        {event.description ? (
          <DetailRow icon={<AlignLeft />}>
            <p className="whitespace-pre-wrap text-pretty text-foreground/80">
              {event.description}
            </p>
          </DetailRow>
        ) : null}

        {event.attendees.length > 0 ? (
          <DetailRow icon={<Users />}>
            <p className="font-medium">
              {event.attendees.length}{" "}
              {event.attendees.length === 1 ? "guest" : "guests"}
            </p>
            <p className="text-xs text-muted-foreground">
              {accepted} yes
              {awaiting > 0 ? `, ${awaiting} awaiting` : ""}
            </p>
            <ul role="list" className="mt-2 space-y-1.5">
              {event.attendees
                .slice()
                .sort(
                  (a, b) => Number(isOrganizer(b)) - Number(isOrganizer(a)),
                )
                .map((a) => {
                const meta = RESPONSE_META[effectiveResponse(a)];
                return (
                  <li key={a.user_id} className="flex items-center gap-2">
                    <Avatar className="size-6">
                      <AvatarImage src={a.avatar_url ?? undefined} />
                      <AvatarFallback>
                        {(a.name ?? "?").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-foreground/90">
                      {a.name ?? "Unnamed"}
                      {a.user_id === currentUserId ? " (you)" : ""}
                    </span>
                    {isOrganizer(a) ? (
                      <span className="text-xs text-muted-foreground">
                        Organizer
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-xs font-medium",
                          meta.className,
                        )}
                      >
                        {meta.icon}
                        {meta.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </DetailRow>
        ) : null}
      </div>

      {me && !iAmOrganizer ? (
        <div className="-mx-4 -mb-4 flex items-center justify-between gap-3 rounded-b-xl border-t bg-muted/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">Going?</span>
          <div className="flex gap-1.5">
            {(
              [
                ["accepted", "Yes"],
                ["tentative", "Maybe"],
                ["declined", "No"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="outline"
                disabled={rsvpPending}
                onClick={() => rsvp(value)}
                className={cn(
                  myResponse === value &&
                    "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                )}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task details
// ---------------------------------------------------------------------------

const TASK_STATUS_LABEL: Record<TaskEvent["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export function TaskDetails({
  event,
  propertyId,
  onMutated,
  onClose,
}: {
  event: TaskEvent;
  propertyId: string;
  onMutated?: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();
  const priorityMeta = PRIORITY_META[event.priority];

  function handleUnschedule() {
    startTransition(async () => {
      const r = await unscheduleTask(propertyId, event.id);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success("Task unscheduled");
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      onMutated?.();
      onClose();
    });
  }

  return (
    <div className="space-y-4">
      <DetailsHeader event={event} />

      <div className="space-y-3">
        <DetailRow icon={<CircleDashed />}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                priorityMeta.badgeClass,
              )}
            >
              {priorityMeta.label}
            </span>
            <StatusBadge tone="neutral" dot={false}>
              {TASK_STATUS_LABEL[event.status]}
            </StatusBadge>
          </div>
        </DetailRow>

        {event.due_at ? (
          <DetailRow icon={<CalendarClock />}>
            <p className="text-foreground/90">
              Due{" "}
              {new Date(event.due_at).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          </DetailRow>
        ) : null}

        {event.description ? (
          <DetailRow icon={<AlignLeft />}>
            <p className="line-clamp-4 whitespace-pre-wrap text-pretty text-foreground/80">
              {event.description}
            </p>
          </DetailRow>
        ) : null}

        <DetailRow icon={<Clock />}>
          <p className="text-muted-foreground">
            Drag the block on the grid to reschedule, or unschedule to send
            it back to the rail.
          </p>
        </DetailRow>
      </div>

      <div className="-mx-4 -mb-4 flex items-center justify-end gap-2 rounded-b-xl border-t bg-muted/50 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUnschedule}
          disabled={pending}
        >
          Unschedule
        </Button>
        <Button
          size="sm"
          nativeButton={false}
          render={<a href={`/p/${propertyId}/tasks/${event.id}`} />}
        >
          Open task
          <ArrowUpRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking details (guest reservations — tables, spa, tours)
// ---------------------------------------------------------------------------

// Status→tone map matching the domain source of truth in
// lib/bookings/status-colors.ts (pending=warning, confirmed=info,
// seated=violet, completed/cancelled=neutral, no_show=danger).
const BOOKING_STATUS_BADGE: Record<
  BookingEvent["booking_status"],
  { label: string; tone: React.ComponentProps<typeof StatusBadge>["tone"] }
> = {
  pending: { label: "Pending", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "info" },
  seated: { label: "Seated", tone: "violet" },
  completed: { label: "Completed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "No-show", tone: "danger" },
};

export function BookingDetails({
  event,
  propertyId,
}: {
  event: BookingEvent;
  propertyId: string;
}) {
  const badge = BOOKING_STATUS_BADGE[event.booking_status];
  return (
    <div className="space-y-4">
      <DetailsHeader event={event} subtitle={event.service_name} />

      <div className="space-y-3">
        <DetailRow icon={<Users />}>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-foreground/90">
              {event.guest_name} · party of {event.party_size}
            </p>
            <StatusBadge tone={badge.tone} dot={false}>
              {badge.label}
            </StatusBadge>
          </div>
          {event.guest_phone ? (
            <p className="text-xs text-muted-foreground">{event.guest_phone}</p>
          ) : null}
        </DetailRow>

        <DetailRow icon={<CircleDashed />}>
          <p className="text-foreground/90">{event.reference}</p>
          <p className="text-xs text-muted-foreground">
            {event.booking_source === "chatbot"
              ? "Booked by a guest via chatbot"
              : event.booking_source === "web"
                ? "Booked online"
              : "Booked by staff"}
          </p>
        </DetailRow>
      </div>

      <div className="-mx-4 -mb-4 flex items-center justify-between gap-3 rounded-b-xl border-t bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Confirm, cancel, or complete from Bookings.
        </p>
        <Button
          size="sm"
          nativeButton={false}
          render={
            <a
              href={
                event.booking_status === "pending"
                  ? `/p/${propertyId}/bookings?view=pending`
                  : `/p/${propertyId}/bookings`
              }
            />
          }
        >
          Open Bookings
          <ArrowUpRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// External (Google / Outlook) details
// ---------------------------------------------------------------------------

export function ExternalDetails({ event }: { event: ExternalEvent }) {
  const providerName = event.provider === "google" ? "Google" : "Outlook";
  return (
    <div className="space-y-4">
      <DetailsHeader event={event} subtitle={`${providerName} Calendar`} />

      <div className="space-y-3">
        {event.location ? (
          <DetailRow icon={<MapPin />}>
            <p className="text-foreground/90">{event.location}</p>
          </DetailRow>
        ) : null}

        {event.description ? (
          <DetailRow icon={<AlignLeft />}>
            <p className="line-clamp-4 whitespace-pre-wrap text-pretty text-foreground/80">
              {event.description}
            </p>
          </DetailRow>
        ) : null}

        {event.organizer_email ? (
          <DetailRow icon={<Users />}>
            <p className="text-foreground/90">{event.organizer_email}</p>
            <p className="text-xs text-muted-foreground">Organizer</p>
          </DetailRow>
        ) : null}
      </div>

      <div className="-mx-4 -mb-4 flex items-center justify-between gap-3 rounded-b-xl border-t bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Editing happens in {providerName} Calendar.
        </p>
        {event.html_link ? (
          <Button
            size="sm"
            nativeButton={false}
            render={
              <a href={event.html_link} target="_blank" rel="noreferrer" />
            }
          >
            Open in {providerName}
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
