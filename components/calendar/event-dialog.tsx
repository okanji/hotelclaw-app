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
import type { CalendarEvent } from "@/lib/calendar/types";

type Props = {
  propertyId: string;
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial:
    | { mode: "create"; start: Date; end: Date }
    | { mode: "edit"; event: CalendarEvent };
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
}: Props) {
  const editing = initial.mode === "edit" ? initial.event : null;
  const isMeeting = editing?.source === "meeting" || initial.mode === "create";

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
        meetingId: editing?.source === "meeting" ? editing.id : undefined,
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        start: fromLocalInput(startInput).toISOString(),
        end: fromLocalInput(endInput).toISOString(),
        allDay,
        attendeeIds: Array.from(attendees).filter((id) => id !== currentUserId),
        withVideoCall,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Event updated" : "Event created");
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      onOpenChange(false);
    });
  }

  function handleDelete() {
    if (editing?.source !== "meeting") return;
    startTransition(async () => {
      const result = await deleteMeeting(propertyId, editing.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Event deleted");
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      onOpenChange(false);
    });
  }

  // External events are read-only — render a deep link in lieu of the form.
  if (editing?.source === "external") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This event lives in {editing.provider === "google" ? "Google" : "Outlook"}{" "}
            Calendar. Editing happens there.
          </p>
          <DialogFooter>
            {editing.html_link ? (
              <Button
                render={
                  <a
                    href={editing.html_link}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                Open in {editing.provider === "google" ? "Google" : "Outlook"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (editing?.source === "task") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Scheduled task — open the task to edit details or change the
            schedule.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              render={<a href={`/p/${propertyId}/tasks/${editing.id}`} />}
            >
              Open task
            </Button>
          </DialogFooter>
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
              className="size-4 rounded border-input"
            />
            All-day event
          </label>

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
            <Label>Attendees</Label>
            <ul className="max-h-40 space-y-1 overflow-auto rounded-md border border-border p-2">
              {(membersQuery.data ?? []).map((m) => {
                const on = attendees.has(m.id) || m.id === currentUserId;
                const isMe = m.id === currentUserId;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={isMe}
                      onClick={() => toggleAttendee(m.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-sm transition-colors",
                        on
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent/50",
                        isMe && "opacity-70",
                      )}
                    >
                      <Avatar className="size-6">
                        <AvatarImage src={m.avatarUrl ?? undefined} />
                        <AvatarFallback>
                          {(m.name ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">
                        {m.name ?? "Unnamed"} {isMe ? "(organizer)" : ""}
                      </span>
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
              className="size-4 rounded border-input"
            />
            {withVideoCall ? (
              <Video className="size-4 text-primary" />
            ) : (
              <VideoOff className="size-4 text-muted-foreground" />
            )}
            Add a Stream video call
          </label>

          <DialogFooter className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
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
