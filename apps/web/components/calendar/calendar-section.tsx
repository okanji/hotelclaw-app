"use client";

import { SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";
import { MiniMonth } from "./mini-month";
import { useCalendarPrefs } from "./calendar-prefs-context";

/**
 * Calendar's node body in the sidebar tree: just the mini month, as a
 * date-jump nav. The page owns every control — the Day / Week / Month / Year
 * switcher and the Calendars popover (show/hide sources, connected accounts)
 * live in the calendar toolbar (`calendar-room.tsx`), because this body is
 * hidden whenever the row is collapsed.
 */
export function CalendarSection({ propertyId }: { propertyId: string }) {
  const { focusDate, setFocusDate } = useCalendarPrefs();
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        {/* Keyed on the property so switching properties resets the
            displayed month along with everything else. */}
        <MiniMonth key={propertyId} value={focusDate} onChange={setFocusDate} />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
