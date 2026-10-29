"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { Gi } from "@/components/gr8r/icon";
import { Av, memberHue } from "@/components/gr8r/home-glyphs";
import { g8c } from "@/components/gr8r/calendar-glyphs";

/**
 * Right-rail panel listing every property member with toggle avatars. Each
 * toggled-on user contributes a translucent free/busy lane to the grid.
 * Renders inline in the calendar room — no portal, no overlay, just a
 * fixed-width column.
 */
export function TeamOverlayPanel({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  const membersQuery = useQuery(propertyMembersQueryOptions(propertyId));
  const { overlayUsers, toggleOverlayUser } = useCalendarPrefs();

  const members = useMemo(
    () =>
      (membersQuery.data ?? []).filter((m) => m.id !== currentUserId),
    [membersQuery.data, currentUserId],
  );

  if (members.length === 0) return null;

  // gr8r-styled rail section; each member's swatch is `memberHue` — the
  // same colour the room hands the grid for their free/busy lane.
  return (
    <section className="cal-rail-sec" aria-label="Team availability">
      <div className="cal-rail-h">
        <Gi icon={Users} size={14} />
        Team availability
        {overlayUsers.size > 0 ? (
          <span className="cnt">{overlayUsers.size} on</span>
        ) : null}
      </div>
      <ul role="list" className="cal-rail-b" style={{ maxHeight: 224 }}>
        {members.map((m) => {
          const on = overlayUsers.has(m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggleOverlayUser(m.id)}
                className={on ? "cal-mem on" : "cal-mem"}
              >
                <Av member={m} size="md" />
                <span className="trunc">{m.name ?? "Unnamed"}</span>
                <span aria-hidden className="sw" style={g8c(memberHue(m.id))} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
