"use client";

import { usePathname } from "next/navigation";
import { CalendarRoom } from "./calendar-room";

const IN_CALENDAR = /^\/p\/[^/]+\/calendar(?:\/|$)/;

/**
 * Persistent calendar surface — mounted in the property layout. Mirrors
 * `TasksSurface`/`DocumentsSurface`: renders only on `/calendar*` URLs and
 * returns `null` everywhere else so the property layout doesn't double-
 * render the calendar above other sections.
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
    <CalendarRoom propertyId={propertyId} currentUserId={currentUserId} />
  );
}
