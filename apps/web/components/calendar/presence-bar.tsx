"use client";

import {
  shallow,
  useOthersMapped,
  useSelf,
} from "@liveblocks/react/suspense";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
    <div className="flex items-center -space-x-1.5">
      {people.slice(0, 5).map(([key, p]) => (
        <Tooltip key={key}>
          <TooltipTrigger>
            <Avatar
              className={cn(
                "size-6 ring-2 ring-background",
                p.editingEventId && "ring-warning",
              )}
            >
              <AvatarImage src={p.avatar} />
              <AvatarFallback>
                {(p.name ?? "?").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
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
        <span className="ml-2 text-xs text-faint-foreground">
          +{people.length - 5}
        </span>
      ) : null}
    </div>
  );
}
