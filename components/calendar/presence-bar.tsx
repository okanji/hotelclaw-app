"use client";

import { useOthers, useSelf } from "@liveblocks/react/suspense";
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
 */
export function CalendarPresenceBar() {
  const self = useSelf();
  const others = useOthers();
  if (!self || others.length === 0) return null;
  return (
    <div className="flex items-center -space-x-1.5">
      {[self, ...others].slice(0, 5).map((p) => {
        const editingId = p.presence?.editingEventId;
        const focused = p.presence?.focusedDay;
        return (
          <Tooltip key={p.connectionId}>
            <TooltipTrigger>
              <Avatar
                className={cn(
                  "size-6 ring-2 ring-card",
                  editingId && "ring-amber-400",
                )}
              >
                <AvatarImage src={p.info?.avatar} />
                <AvatarFallback>
                  {(p.info?.name ?? "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                <div className="font-medium">{p.info?.name ?? "Unnamed"}</div>
                {editingId ? (
                  <div className="text-muted-foreground">
                    Editing an event
                  </div>
                ) : focused ? (
                  <div className="text-muted-foreground">
                    Looking at{" "}
                    {new Date(focused).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                ) : null}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
      {others.length + 1 > 5 ? (
        <span className="ml-2 text-[11px] text-muted-foreground">
          +{others.length + 1 - 5}
        </span>
      ) : null}
    </div>
  );
}
