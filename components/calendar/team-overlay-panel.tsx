"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { cn } from "@/lib/utils";

const PALETTE = [
  "ef4444",
  "f97316",
  "eab308",
  "22c55e",
  "06b6d4",
  "3b82f6",
  "8b5cf6",
  "ec4899",
];

/** Same hash as `calendar-room.tsx` — keep them in sync. */
function colorFor(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

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

  return (
    <aside className="hidden w-56 shrink-0 border-l border-border bg-muted/30 lg:flex lg:flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        <Users className="size-3.5" />
        Team availability
      </div>
      <ul className="flex flex-col gap-0.5 p-1.5">
        {members.map((m) => {
          const on = overlayUsers.has(m.id);
          const color = colorFor(m.id);
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
                {/* Lane swatch — the colour the grid uses for this user's
                    free/busy bars when they're toggled on. */}
                <span
                  aria-hidden
                  className="ml-auto size-2.5 rounded-sm"
                  style={{
                    backgroundColor: on ? `#${color}` : undefined,
                    boxShadow: on
                      ? undefined
                      : `inset 0 0 0 1px #${color}`,
                  }}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
