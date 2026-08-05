"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { saveMeeting, deleteMeeting } from "@/lib/calendar/actions";
import {
  BookingDetails,
  ExternalDetails,
  MeetingDetails,
  TaskDetails,
} from "./event-details";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { MeetingRecurrence } from "@/lib/db/types";
import { NativeSelect } from "@/components/ui/native-select";

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

  // Bookings are read-only here — manage them from the Bookings section.
  if (editing?.source === "booking") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <BookingDetails event={editing} propertyId={propertyId} />
        </DialogContent>
      </Dialog>
    );
  }

  // External events are read-only — rich details with a provider deep link.
  if (editing?.source === "external") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <ExternalDetails event={editing} />
        </DialogContent>
      </Dialog>
    );
  }

  if (editing?.source === "task") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
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
        <DialogContent>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit event" : "New event"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sprint sync"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="event-start">Start</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end">End</Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="size-4 accent-ring"
            />
            All-day event
          </label>

          <div className="space-y-2">
            <Label htmlFor="event-repeats">Repeats</Label>
            <NativeSelect
              id="event-repeats"
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
            </NativeSelect>
            {isOccurrence ? (
              <p className="text-xs text-muted-foreground">
                Editing applies to the whole series.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Conference room or video link"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-description">Description</Label>
            <Textarea
              id="event-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Guests</Label>
            <ul role="list" className="max-h-40 space-y-px overflow-auto rounded-md bg-muted p-1">
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
                        className={cn(
                          "flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors focus-visible:shadow-focus focus-visible:outline-none",
                          on
                            ? "bg-accent-pressed text-foreground"
                            : "text-muted-foreground hover:bg-accent",
                          isOrganizer && "cursor-default",
                        )}
                      >
                        <Avatar className="size-6">
                          <AvatarImage src={m.avatarUrl ?? undefined} />
                          <AvatarFallback>
                            {(m.name ?? "?").slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate">
                          {m.name ?? "Unnamed"}
                          {isMe ? " (you)" : ""}
                        </span>
                        {isOrganizer ? (
                          <span className="shrink-0 text-xs text-faint-foreground">
                            Organizer
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withVideoCall}
              onChange={(e) => setWithVideoCall(e.target.checked)}
              className="size-4 accent-ring"
            />
            {withVideoCall ? (
              <Video className="size-4 text-primary-ink" />
            ) : (
              <VideoOff className="size-4 text-muted-foreground" />
            )}
            Add a Stream video call
          </label>

          <DialogFooter>
            {editing ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleDelete}
                disabled={pending}
                className="mr-auto"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Create event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
