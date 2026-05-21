"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { cn } from "@/lib/utils";

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

  const members = (membersQuery.data ?? []).filter(
    (m) => m.id !== currentUserId,
  );

  if (members.length === 0) return null;

  return (
    <aside className="hidden w-56 shrink-0 border-l border-border bg-muted/30 lg:flex lg:flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        <Users className="size-3.5" />
        Team availability
      </div>
      <ul className="flex flex-col gap-0.5 p-1.5">
        {members.map((m) => {
          const on = overlayUsers.has(m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => toggleOverlayUser(m.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                  on
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground/80 hover:bg-accent/50",
                )}
              >
                <Avatar className="size-6">
                  <AvatarImage src={m.avatarUrl ?? undefined} />
                  <AvatarFallback>
                    {(m.name ?? "?").slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{m.name ?? "Unnamed"}</span>
                <span
                  aria-hidden
                  className={cn(
                    "ml-auto size-2 rounded-full",
                    on ? "bg-emerald-500" : "bg-muted-foreground/30",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
