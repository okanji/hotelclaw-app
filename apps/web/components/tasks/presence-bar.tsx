"use client";

import {
  ClientSideSuspense,
  shallow,
  useOthersMapped,
} from "@liveblocks/react/suspense";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function PresenceBarInner() {
  // Mapped + shallow so this only re-renders on join/leave (info is static
  // per connection) — NOT on every presence change in the room (drag flags
  // etc.), which raw useOthers() would. See liveblocks-best-practices
  // "performant others and presence".
  const others = useOthersMapped(
    (o) => ({ name: o.info?.name, avatar: o.info?.avatar }),
    shallow,
  );
  if (others.length === 0) return null;
  return (
    <div className="flex -space-x-2">
      {others.slice(0, 5).map(([connectionId, info]) => {
        const name = info.name ?? "?";
        const initials = name
          .split(/\s+/)
          .map((p) => p[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <Avatar
            key={connectionId}
            className="size-7 border-2 border-background"
            title={name}
          >
            <AvatarImage src={info.avatar} alt={name} />
            <AvatarFallback className="text-xs">{initials || "?"}</AvatarFallback>
          </Avatar>
        );
      })}
      {others.length > 5 ? (
        <div className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-xs">
          +{others.length - 5}
        </div>
      ) : null}
    </div>
  );
}

export function PresenceBar() {
  return (
    <ClientSideSuspense fallback={null}>
      <PresenceBarInner />
    </ClientSideSuspense>
  );
}
