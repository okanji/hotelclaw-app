"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
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
  Flag,
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
import { Gi } from "@/components/gr8r/icon";
import { Av, PR_NAME, PrIcon, StIcon } from "@/components/gr8r/home-glyphs";
import { useMeeting } from "@/lib/stream/meeting-context";
import { respondToMeeting, unscheduleTask } from "@/lib/calendar/actions";
import type {
  AttendeeResponse,
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
 *
 * Drawn in gr8r's idiom (the dialog / popover hosts carry `g8 g8-port`):
 * a `.kv` property list, `.badge` states, `.btn` / `.ibtn` actions.
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

/** One gr8r `.kv` row: icon + label in the `dt`, the value in the `dd`. */
function KvRow({
  icon,
  label,
  children,
  top,
}: {
  icon: React.ComponentProps<typeof Gi>["icon"];
  label: string;
  children: React.ReactNode;
  /** Long values (descriptions, guest lists) align to the label's top. */
  top?: boolean;
}) {
  return (
    <>
      <dt style={top ? { alignSelf: "start" } : undefined}>
        <Gi icon={icon} size={14} />
        {label}
      </dt>
      <dd style={top ? { paddingTop: 6, paddingBottom: 4 } : undefined}>{children}</dd>
    </>
  );
}

/**
 * Which element renders the details title. Defaults to `DialogTitle` (the
 * details panel's original home was a modal). Rendered inside a non-modal
 * popover — where there is no Dialog to register a title id — the popover
 * provides `"h2"` so base-ui doesn't throw. Read as a flag, never rendered as
 * a dynamic component (react-hooks/static-components).
 */
export const DetailsTitleContext = createContext<React.ElementType>(DialogTitle);

const TITLE_STYLE: CSSProperties = {
  fontSize: "var(--g8-fs-md)",
  fontWeight: 600,
  lineHeight: 1.35,
  letterSpacing: "-0.01em",
  margin: 0,
  textWrap: "balance",
};

function DetailsHeader({
  event,
  subtitle,
  actions,
}: {
  event: CalendarEvent;
  subtitle?: string | null;
  actions?: React.ReactNode;
}) {
  const plainHeading = useContext(DetailsTitleContext) !== DialogTitle;
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10, paddingRight: 28 }}>
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          borderRadius: 4,
          marginTop: 4,
          flexShrink: 0,
          background: eventSwatch(event),
        }}
      />
      <div className="grow" style={{ minWidth: 0 }}>
        {plainHeading ? (
          <h2 style={TITLE_STYLE}>{event.title}</h2>
        ) : (
          <DialogTitle style={TITLE_STYLE}>{event.title}</DialogTitle>
        )}
        <div className="muted" style={{ fontSize: "var(--g8-fs-sm)", marginTop: 2 }}>
          {formatWhen(event)}
        </div>
        {subtitle ? (
          <div className="faint" style={{ fontSize: "var(--g8-fs-sm)" }}>{subtitle}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="row" style={{ gap: 2, flexShrink: 0 }}>{actions}</div>
      ) : null}
    </div>
  );
}

/** Footer: a hint on the left, the primary action on the right. */
function DetailsFoot({
  hint,
  children,
}: {
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="row" style={{ gap: 8, marginTop: 14 }}>
      {hint ? (
        <span className="faint grow" style={{ fontSize: "var(--g8-fs-xs)" }}>{hint}</span>
      ) : (
        <span className="sp" />
      )}
      {children}
    </div>
  );
}

const KV_STYLE: CSSProperties = { marginTop: 12, gridTemplateColumns: "96px minmax(0, 1fr)" };

const RESPONSE_META: Record<
  AttendeeResponse,
  { label: string; icon: React.ComponentProps<typeof Gi>["icon"]; tone: string }
> = {
  accepted: { label: "Yes", icon: Check, tone: "green" },
  declined: { label: "No", icon: X, tone: "red" },
  tentative: { label: "Maybe", icon: HelpCircle, tone: "amber" },
  pending: { label: "Awaiting", icon: CircleDashed, tone: "gray" },
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
    <div>
      <DetailsHeader
        event={event}
        subtitle={recurrenceLabel(event.recurrence, new Date(event.start))}
        actions={
          <>
            <button
              type="button"
              className="ibtn ibtn-sm"
              onClick={onEdit}
              aria-label="Edit event"
              title="Edit event"
            >
              <Gi icon={Pencil} size={14} />
            </button>
            <button
              type="button"
              className="ibtn ibtn-sm"
              onClick={onDelete}
              disabled={deletePending}
              aria-label="Delete event"
              title="Delete event"
            >
              <Gi icon={Trash2} size={14} />
            </button>
          </>
        }
      />

      {hasVideo && !callEnded ? (
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={joinCall}
            disabled={!videoReady}
          >
            <Gi icon={Video} size={14} />
            Join video call
          </button>
          <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
            {event.started_at
              ? "In progress — others may already be in"
              : "Camera preview before you join"}
          </span>
        </div>
      ) : null}

      <dl className="kv" style={KV_STYLE}>
        {hasVideo && callEnded ? (
          <KvRow icon={Video} label="Call">
            <span className="muted">
              Ended
              {event.ended_at ? ` · ${timeLabel(new Date(event.ended_at))}` : ""}
            </span>
          </KvRow>
        ) : null}

        {event.location ? (
          <KvRow icon={MapPin} label="Location">
            <span>{event.location}</span>
          </KvRow>
        ) : null}

        {event.description ? (
          <KvRow icon={AlignLeft} label="Notes" top>
            <span className="muted" style={{ whiteSpace: "pre-wrap", textWrap: "pretty" }}>
              {event.description}
            </span>
          </KvRow>
        ) : null}

        {event.attendees.length > 0 ? (
          <KvRow icon={Users} label="Guests" top>
            <div className="stack" style={{ gap: 6, width: "100%" }}>
              <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
                {event.attendees.length}{" "}
                {event.attendees.length === 1 ? "guest" : "guests"} · {accepted} yes
                {awaiting > 0 ? `, ${awaiting} awaiting` : ""}
              </span>
              {event.attendees
                .slice()
                .sort((a, b) => Number(isOrganizer(b)) - Number(isOrganizer(a)))
                .map((a) => {
                  const meta = RESPONSE_META[effectiveResponse(a)];
                  return (
                    <div key={a.user_id} className="row" style={{ gap: 8 }}>
                      <Av
                        member={{ id: a.user_id, name: a.name, avatarUrl: a.avatar_url }}
                      />
                      <span className="trunc grow" style={{ minWidth: 0 }}>
                        {a.name ?? "Unnamed"}
                        {a.user_id === currentUserId ? " (you)" : ""}
                      </span>
                      {isOrganizer(a) ? (
                        <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
                          Organizer
                        </span>
                      ) : (
                        <span className={`badge ${meta.tone}`}>
                          <Gi icon={meta.icon} size={11} />
                          {meta.label}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </KvRow>
        ) : null}
      </dl>

      {me && !iAmOrganizer ? (
        <DetailsFoot hint="Going?">
          <div className="seg" role="group" aria-label="Your response">
            {(
              [
                ["accepted", "Yes"],
                ["tentative", "Maybe"],
                ["declined", "No"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={myResponse === value ? "on" : ""}
                aria-pressed={myResponse === value}
                disabled={rsvpPending}
                onClick={() => rsvp(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </DetailsFoot>
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
    <div>
      <DetailsHeader event={event} />

      <dl className="kv" style={KV_STYLE}>
        <KvRow icon={CircleDashed} label="Status">
          <span className="row" style={{ gap: 6 }}>
            <StIcon task={{ status: event.status }} />
            {TASK_STATUS_LABEL[event.status]}
          </span>
        </KvRow>
        <KvRow icon={Flag} label="Priority">
          <span className="row" style={{ gap: 6 }}>
            <PrIcon priority={event.priority} />
            {PR_NAME[event.priority]}
          </span>
        </KvRow>
        {event.due_at ? (
          <KvRow icon={CalendarClock} label="Due">
            <span>
              {new Date(event.due_at).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          </KvRow>
        ) : null}
        {event.description ? (
          <KvRow icon={AlignLeft} label="Notes" top>
            <span
              className="muted"
              style={{
                whiteSpace: "pre-wrap",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {event.description}
            </span>
          </KvRow>
        ) : null}
      </dl>

      <div className="faint row" style={{ gap: 6, marginTop: 8, fontSize: "var(--g8-fs-xs)", alignItems: "flex-start" }}>
        <Gi icon={Clock} size={12} />
        <span>Drag the block on the grid to reschedule, or unschedule to send it back to the rail.</span>
      </div>

      <DetailsFoot>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleUnschedule}
          disabled={pending}
        >
          Unschedule
        </button>
        <a href={`/p/${propertyId}/tasks/${event.id}`} className="btn btn-primary btn-sm">
          Open task
          <Gi icon={ArrowUpRight} size={14} />
        </a>
      </DetailsFoot>
    </div>
  );
}

// ---------------------------------------------------------------------------
// External (Google / Outlook) details
// ---------------------------------------------------------------------------

export function ExternalDetails({ event }: { event: ExternalEvent }) {
  const providerName = event.provider === "google" ? "Google" : "Outlook";
  const hasRows = Boolean(event.location || event.description || event.organizer_email);
  return (
    <div>
      <DetailsHeader event={event} subtitle={`${providerName} Calendar`} />

      {hasRows ? (
        <dl className="kv" style={KV_STYLE}>
          {event.location ? (
            <KvRow icon={MapPin} label="Location">
              <span>{event.location}</span>
            </KvRow>
          ) : null}
          {event.description ? (
            <KvRow icon={AlignLeft} label="Notes" top>
              <span
                className="muted"
                style={{
                  whiteSpace: "pre-wrap",
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {event.description}
              </span>
            </KvRow>
          ) : null}
          {event.organizer_email ? (
            <KvRow icon={Users} label="Organizer">
              <span className="trunc">{event.organizer_email}</span>
            </KvRow>
          ) : null}
        </dl>
      ) : null}

      <DetailsFoot hint={`Editing happens in ${providerName} Calendar.`}>
        {event.html_link ? (
          <a
            href={event.html_link}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary btn-sm"
          >
            Open in {providerName}
            <Gi icon={ExternalLink} size={14} />
          </a>
        ) : null}
      </DetailsFoot>
    </div>
  );
}
