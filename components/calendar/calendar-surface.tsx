"use client";

import { usePathname } from "next/navigation";
import { RoomProvider } from "@liveblocks/react/suspense";
import { ClientSideSuspense } from "@liveblocks/react";
import { roomIdForCalendar } from "@/lib/liveblocks/rooms";
import { CalendarRoom } from "./calendar-room";

const IN_CALENDAR = /^\/p\/[^/]+\/calendar(?:\/|$)/;

/**
 * Persistent calendar surface — mounted in the property layout. Mirrors
 * `TasksSurface`/`DocumentsSurface`: renders only on `/calendar*` URLs and
 * returns `null` everywhere else so the property layout doesn't double-
 * render the calendar above other sections.
 *
 * Wrapped in a Liveblocks `RoomProvider` so the calendar grows live
 * presence (avatar stack, cursors, "Alice is editing" chips) + room
 * broadcasts that let peers' grids refresh on a save without waiting for
 * the Supabase Realtime hop. Source of truth stays in Postgres; the room
 * is purely a presence + ping channel.
 */
export function CalendarSurface({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  const pathname = usePathname();
  if (!IN_CALENDAR.test(pathname)) return null;
  return (
    <RoomProvider
      id={roomIdForCalendar(propertyId)}
      initialPresence={{
        cursor: null,
        selectedTaskId: null,
        draggingTaskId: null,
        editingEventId: null,
        focusedDay: null,
      }}
    >
      {/* Suspense boundary keeps the calendar from flashing while the
          Liveblocks websocket establishes — we render the grid as soon as
          the room connection is ready, no skeleton needed because the
          events query is already hydrated by the layout. */}
      <ClientSideSuspense fallback={null}>
        <CalendarRoom propertyId={propertyId} currentUserId={currentUserId} />
      </ClientSideSuspense>
    </RoomProvider>
  );
}
