"use client";

import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteMeeting } from "@/lib/calendar/actions";
import {
  BookingDetails,
  DetailsTitleContext,
  ExternalDetails,
  MeetingDetails,
  TaskDetails,
} from "./event-details";
import type { CalendarEvent } from "@/lib/calendar/types";

/**
 * Source-dispatched event details, rendered inside the non-modal grid popover
 * (and the cluster list) rather than the modal dialog. Wraps the detail
 * components in `DetailsTitleContext` so their heading renders as a plain `h2`
 * — there is no Dialog here to own a title id. Editing stays a modal affair:
 * `onEdit` hands back up to the room, which opens `EventDialog` on the form.
 *
 * Delete is owned here (the detail components only signal intent via `onDelete`)
 * and only meetings are deletable; other sources surface their own actions.
 */
export function EventDetailBody({
  event,
  propertyId,
  currentUserId,
  onEdit,
  onClose,
  onMutated,
}: {
  event: CalendarEvent;
  propertyId: string;
  currentUserId: string;
  onEdit: () => void;
  onClose: () => void;
  onMutated?: () => void;
}) {
  const qc = useQueryClient();
  const [deletePending, startDelete] = useTransition();

  function handleDelete() {
    if (event.source !== "meeting") return;
    const baseMeetingId = event.id.split("@")[0];
    if (
      event.id.includes("@") &&
      !confirm(
        "This is a recurring event. Deleting will remove the entire series.",
      )
    ) {
      return;
    }
    startDelete(async () => {
      const r = await deleteMeeting(propertyId, baseMeetingId);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success("Event deleted");
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
      onMutated?.();
      onClose();
    });
  }

  return (
    <DetailsTitleContext.Provider value="h2">
      {event.source === "meeting" ? (
        <MeetingDetails
          event={event}
          propertyId={propertyId}
          currentUserId={currentUserId}
          onEdit={onEdit}
          onDelete={handleDelete}
          onClose={onClose}
          onMutated={onMutated}
          deletePending={deletePending}
        />
      ) : event.source === "task" ? (
        <TaskDetails
          event={event}
          propertyId={propertyId}
          onMutated={onMutated}
          onClose={onClose}
        />
      ) : event.source === "booking" ? (
        <BookingDetails event={event} propertyId={propertyId} />
      ) : (
        <ExternalDetails event={event} />
      )}
    </DetailsTitleContext.Provider>
  );
}
