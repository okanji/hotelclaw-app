"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/count-badge";
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
    <aside className="flex w-64 shrink-0 flex-col border-t border-border">
      <div className="flex h-11 items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-2 text-sm font-medium text-secondary-ink">
          <Users className="size-3.5 shrink-0 text-faint-foreground" />
          Team availability
        </div>
        {overlayUsers.size > 0 ? (
          <CountBadge>{overlayUsers.size} on</CountBadge>
        ) : null}
      </div>
      <ul role="list" className="flex max-h-56 flex-col gap-px overflow-auto p-2 pt-0">
        {members.map((m) => {
          const on = overlayUsers.has(m.id);
          const color = colorFor(m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => toggleOverlayUser(m.id)}
                className={cn(
                  "flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium transition-colors focus-visible:shadow-focus focus-visible:outline-none",
                  on
                    ? "bg-accent-pressed text-foreground"
                    : "text-secondary-ink hover:bg-accent",
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
                  className="ml-auto size-2.5 shrink-0 rounded-full"
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
