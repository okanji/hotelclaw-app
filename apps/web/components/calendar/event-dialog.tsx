"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { saveMeeting, deleteMeeting } from "@/lib/calendar/actions";
import {
  ExternalDetails,
  MeetingDetails,
  TaskDetails,
} from "./event-details";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { MeetingRecurrence } from "@/lib/db/types";

type RecurrencePreset = "none" | "daily" | "weekdays" | "weekly" | "monthly";

function recurrenceToPreset(r: MeetingRecurrence | null): RecurrencePreset {
  if (!r) return "none";
  if (r.frequency === "daily") return "daily";
  if (
    r.frequency === "weekly" &&
    r.byday &&
    r.byday.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => r.byday!.includes(d))
  ) {
    return "weekdays";
  }
  if (r.frequency === "weekly") return "weekly";
  if (r.frequency === "monthly") return "monthly";
  return "none";
}

function presetToRecurrence(
  preset: RecurrencePreset,
): MeetingRecurrence | null {
  if (preset === "none") return null;
  if (preset === "daily") return { frequency: "daily", interval: 1 };
  if (preset === "weekdays") {
    return { frequency: "weekly", interval: 1, byday: [1, 2, 3, 4, 5] };
  }
  if (preset === "weekly") return { frequency: "weekly", interval: 1 };
  return { frequency: "monthly", interval: 1 };
}

type Props = {
  propertyId: string;
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial:
    | { mode: "create"; start: Date; end: Date }
    | { mode: "edit"; event: CalendarEvent; view?: "details" | "edit" };
  /**
   * Called after a successful save/delete. The calendar room hooks this up
   * to broadcast `calendar-invalidate` over Liveblocks so peers refresh
   * immediately instead of waiting for Supabase Realtime.
   */
  onMutated?: () => void;
};

/** Datetime-local takes "YYYY-MM-DDTHH:mm" in *local* time. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): Date {
  return new Date(s);
}

/**
 * Dialog used to create a new meeting/event or edit an existing one. Tasks
 * and external events open here too but in read-only mode for v1 — the
 * edit form only commits to in-app meetings. External events get a "View
 * in Google/Outlook" link instead; tasks deep-link to the task detail.
 */
export function EventDialog({
  propertyId,
  currentUserId,
  open,
  onOpenChange,
  initial,
  onMutated,
}: Props) {
  const editing = initial.mode === "edit" ? initial.event : null;
  const isMeeting = editing?.source === "meeting" || initial.mode === "create";

  // The grid now opens event details in a non-modal popover, so a click that
  // reaches this modal is an explicit edit (`view: "edit"`). The "details"
  // view is still honoured for callers that ask for it (e.g. the month grid).
  // Creating goes straight to the form.
  const [view, setView] = useState<"details" | "edit">(
    initial.mode === "edit" ? initial.view ?? "details" : "edit",
  );

  const start = editing
    ? new Date(editing.start)
    : (initial as { start: Date }).start;
  const end = editing
    ? new Date(editing.end)
    : (initial as { end: Date }).end;

  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [location, setLocation] = useState(
    editing?.source === "meeting" ? editing.location ?? "" : "",
  );
  const [startInput, setStartInput] = useState(toLocalInput(start));
  const [endInput, setEndInput] = useState(toLocalInput(end));
  const [allDay, setAllDay] = useState(editing?.all_day ?? false);
  const [withVideoCall, setWithVideoCall] = useState(
    editing?.source === "meeting"
      ? editing.stream_call_id?.startsWith("cal-") !== true
      : true,
  );

  const initialAttendees = useMemo(() => {
    if (editing?.source === "meeting") {
      return new Set(editing.attendees.map((a) => a.user_id));
    }
    return new Set<string>([currentUserId]);
  }, [editing, currentUserId]);
  const [attendees, setAttendees] = useState<Set<string>>(initialAttendees);

  // The organizer is whoever created the meeting (host_id), NOT whoever is
  // editing. host_id is the source of truth; the attendee flag is a
  // fallback for legacy rows. Creating a meeting makes you the organizer.
  const organizerId =
    editing?.source === "meeting"
      ? editing.host_id ??
        editing.attendees.find((a) => a.is_organizer)?.user_id ??
        currentUserId
      : currentUserId;

  // Recurring meetings are expanded server-side and each occurrence has
  // id `<meetingId>@<startIso>`. Edits should hit the underlying row.
  const baseMeetingId =
    editing?.source === "meeting"
      ? editing.id.split("@")[0]
      : undefined;
  const [recurrence, setRecurrence] = useState<RecurrencePreset>(
    editing?.source === "meeting"
      ? recurrenceToPreset(editing.recurrence ?? null)
      : "none",
  );
  const isOccurrence =
    editing?.source === "meeting" && editing.id.includes("@");

  const membersQuery = useQuery(propertyMembersQueryOptions(propertyId));
  const [pending, startTransition] = useTransition();
  const qc = useQueryClient();

  function toggleAttendee(id: string) {
    setAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isMeeting) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const result = await saveMeeting({
        propertyId,
        meetingId: baseMeetingId,
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        start: fromLocalInput(startInput).toISOString(),
        end: fromLocalInput(endInput).toISOString(),
        allDay,
        // The organizer is implicit server-side; everyone else is sent
        // verbatim — including the editor, so a non-organizer editing the
        // meeting neither joins it by accident nor falls off the list.
        attendeeIds: Array.from(attendees).filter((id) => id !== organizerId),
        withVideoCall,
        recurrence: presetToRecurrence(recurrence),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Event updated" : "Event created");
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      onMutated?.();
      onOpenChange(false);
    });
  }

  function handleDelete() {
    if (!baseMeetingId) return;
    if (
      isOccurrence &&
      !confirm(
        "This is a recurring event. Deleting will remove the entire series.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteMeeting(propertyId, baseMeetingId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Event deleted");
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      onMutated?.();
      onOpenChange(false);
    });
  }

  // External events are read-only — rich details with a provider deep link.
  if (editing?.source === "external") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="g8 g8-port">
          <ExternalDetails event={editing} />
        </DialogContent>
      </Dialog>
    );
  }

  if (editing?.source === "task") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="g8 g8-port">
          <TaskDetails
            event={editing}
            propertyId={propertyId}
            onMutated={onMutated}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // Meeting read view — what a click opens. Pencil flips to the form.
  if (editing?.source === "meeting" && view === "details") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="g8 g8-port">
          <MeetingDetails
            event={editing}
            propertyId={propertyId}
            currentUserId={currentUserId}
            onEdit={() => setView("edit")}
            onDelete={handleDelete}
            onClose={() => onOpenChange(false)}
            onMutated={onMutated}
            deletePending={pending}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // gr8r modal anatomy (`.modal-h` / `.modal-b` / `.modal-f`, `.field`,
  // `.label`, `.input` / `.select` / `.textarea`, `.check`, `.btn`) inside
  // the shadcn Dialog (focus trap + a11y). It portals out of the shell, so
  // the popup carries `g8 g8-port` itself.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="g8 g8-port gap-0 p-0 sm:max-w-md">
        <DialogHeader className="modal-h">
          <DialogTitle render={<h2 />}>
            {editing ? "Edit event" : "New event"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="flex min-h-0 flex-col">
          <div className="modal-b" style={{ maxHeight: "70vh" }}>
          <div className="field">
            <label className="label" htmlFor="event-title">Title</label>
            <input
              id="event-title"
              className="input"
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sprint sync"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="event-start">Start</label>
              <input
                id="event-start"
                className="input"
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="event-end">End</label>
              <input
                id="event-end"
                className="input"
                type="datetime-local"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
              />
            </div>
          </div>

          <label className="row" style={{ gap: 8, fontSize: "var(--g8-fs-sm)" }}>
            <input
              type="checkbox"
              className="check"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All-day event
          </label>

          <div className="field">
            <label className="label" htmlFor="event-repeats">Repeats</label>
            <select
              id="event-repeats"
              className="select"
              value={recurrence}
              onChange={(e) =>
                setRecurrence(e.target.value as RecurrencePreset)
              }
            >
              <option value="none">Doesn&apos;t repeat</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            {isOccurrence ? (
              <p className="hint" style={{ margin: 0 }}>
                Editing applies to the whole series.
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="event-location">Location</label>
            <input
              id="event-location"
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Conference room or video link"
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="event-description">Description</label>
            <textarea
              id="event-description"
              className="textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="label">Guests</span>
            <ul
              role="list"
              className="max-h-40 overflow-auto"
              style={{
                border: "1px solid var(--g8-border)",
                borderRadius: "var(--g8-r-sm)",
                padding: 4,
              }}
            >
              {(membersQuery.data ?? [])
                .slice()
                .sort((a, b) =>
                  // Organizer pinned first; the rest keep their order.
                  a.id === organizerId ? -1 : b.id === organizerId ? 1 : 0,
                )
                .map((m) => {
                  const isOrganizer = m.id === organizerId;
                  const isMe = m.id === currentUserId;
                  const on = attendees.has(m.id) || isOrganizer;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={isOrganizer}
                        onClick={() => toggleAttendee(m.id)}
                        aria-pressed={on}
                        className="mi"
                        style={{
                          cursor: isOrganizer ? "default" : undefined,
                          color: on ? "var(--g8-text)" : "var(--g8-text-2)",
                        }}
                      >
                        <input
                          type="checkbox"
                          className="check"
                          tabIndex={-1}
                          aria-hidden
                          readOnly
                          checked={on}
                          style={{ pointerEvents: "none" }}
                        />
                        <Av member={m} size="md" />
                        <span className="min-w-0 flex-1 trunc">
                          {m.name ?? "Unnamed"}
                          {isMe ? " (you)" : ""}
                        </span>
                        {isOrganizer ? (
                          <span className="r">Organizer</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>

          <label
            className="row"
            style={{ gap: 8, fontSize: "var(--g8-fs-sm)", cursor: "pointer" }}
          >
            <input
              type="checkbox"
              className="check"
              checked={withVideoCall}
              onChange={(e) => setWithVideoCall(e.target.checked)}
            />
            <span
              style={{
                display: "flex",
                color: withVideoCall ? "var(--g8-accent)" : "var(--g8-text-3)",
              }}
            >
              <Gi icon={withVideoCall ? Video : VideoOff} size={15} />
            </span>
            Add a Stream video call
          </label>
          </div>

          <div className="modal-f">
            {editing ? (
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={handleDelete}
                disabled={pending}
              >
                <Gi icon={Trash2} size={14} />
                Delete
              </button>
            ) : null}
            <span className="sp" />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Create event"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
