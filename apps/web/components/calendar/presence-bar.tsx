"use client";

import {
  shallow,
  useOthersMapped,
  useSelf,
} from "@liveblocks/react/suspense";
import type { CSSProperties } from "react";
import { initialsOf, memberHue } from "@/components/gr8r/home-glyphs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Stack of teammates currently viewing the calendar room — self first,
 * then everyone else. Each avatar's tooltip shows the day they're
 * focused on (if any) so you can see "Alice is on next week".
 *
 * Lives in the header next to the date label. Renders nothing when no
 * one else is connected (no point in a stack of one).
 *
 * Selector + shallow everywhere: the calendar room streams `cursor`
 * presence at pointer-move frequency (both own and others'), and the
 * unselected useSelf()/useOthers() forms re-render on every one of those
 * updates — a 60fps header repaint while anyone moves their mouse. The
 * selectors subscribe only to the fields this bar actually shows.
 */

type PresencePerson = {
  name?: string;
  avatar?: string;
  editingEventId: string | null;
  focusedDay: string | null;
};

export function CalendarPresenceBar() {
  const self = useSelf(
    (me): PresencePerson => ({
      name: me.info?.name,
      avatar: me.info?.avatar,
      editingEventId: me.presence.editingEventId ?? null,
      focusedDay: me.presence.focusedDay ?? null,
    }),
    shallow,
  );
  const others = useOthersMapped(
    (o): PresencePerson => ({
      name: o.info?.name,
      avatar: o.info?.avatar,
      editingEventId: o.presence.editingEventId ?? null,
      focusedDay: o.presence.focusedDay ?? null,
    }),
    shallow,
  );
  if (!self || others.length === 0) return null;

  const people: (readonly [string | number, PresencePerson])[] = [
    ["self", self] as const,
    ...others,
  ];

  return (
    // gr8r `.avs` stack of `.av.md` discs; someone editing an event gets an
    // amber ring.
    <span className="avs" aria-label="Viewing the calendar">
      {people.slice(0, 5).map(([key, p]) => (
        <Tooltip key={key}>
          <TooltipTrigger
            className="av md"
            style={
              {
                "--g8-c": memberHue(p.name ?? String(key)),
                overflow: "hidden",
                ...(p.editingEventId
                  ? { boxShadow: "0 0 0 2px var(--g8-amber)" }
                  : null),
              } as CSSProperties
            }
          >
            {p.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.avatar}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              initialsOf(p.name ?? "?")
            )}
          </TooltipTrigger>
          <TooltipContent>
            {/* The tooltip is a constant dark slab — its own ink ramp. */}
            <div className="text-xs">
              <div className="font-medium">{p.name ?? "Unnamed"}</div>
              {p.editingEventId ? (
                <div className="opacity-70">Editing an event</div>
              ) : p.focusedDay ? (
                <div className="opacity-70">
                  Looking at{" "}
                  {new Date(p.focusedDay).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
      {people.length > 5 ? (
        <span
          className="av md more"
          style={{ "--g8-c": "var(--g8-gray)" } as CSSProperties}
        >
          +{people.length - 5}
        </span>
      ) : null}
    </span>
  );
}
