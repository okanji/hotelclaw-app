"use client";

import { ClientSideSuspense, useOthers } from "@liveblocks/react/suspense";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function PresenceBarInner() {
  const others = useOthers();
  if (others.length === 0) return null;
  return (
    <div className="flex -space-x-2">
      {others.slice(0, 5).map((o) => {
        const name = o.info?.name ?? "?";
        const initials = name
          .split(/\s+/)
          .map((p) => p[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <Avatar
            key={o.connectionId}
            className="size-7 border-2 border-background"
            title={name}
          >
            <AvatarImage src={o.info?.avatar} alt={name} />
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
