"use client";

import type { CSSProperties } from "react";
import { ClientSideSuspense } from "@liveblocks/react/suspense";
import { Avatar, AvatarStack } from "@liveblocks/react-ui";
import { uniquePresenceUsers } from "@/lib/documents/presence";
import { cn } from "@/lib/utils";

type Viewer = { id: string; name?: string; avatar?: string };

/**
 * Liveblocks `AvatarStack` — circular avatars for users currently in the
 * document room. Must render inside `RoomProvider` for that document.
 */
export function DocumentRoomAvatarStack({
  max = 5,
  size = 28,
  className,
}: {
  max?: number;
  size?: number;
  className?: string;
}) {
  return (
    <ClientSideSuspense fallback={null}>
      <AvatarStack
        max={max}
        size={size}
        className={cn(className)}
        aria-label="People viewing this document"
      />
    </ClientSideSuspense>
  );
}

/**
 * Circular avatar stack for viewers polled outside a room (docs home).
 * Uses Liveblocks `Avatar` so styling matches `AvatarStack` in the editor.
 */
export function DocumentViewerAvatarStack({
  users,
  max = 3,
  size = 20,
  className,
}: {
  users: Viewer[];
  max?: number;
  size?: number;
  className?: string;
}) {
  if (users.length === 0) return null;

  const unique = uniquePresenceUsers(
    users.map((u) => ({
      id: u.id,
      name: u.name ?? "Someone",
      avatar: u.avatar,
    })),
  );
  const visible = unique.slice(0, max);
  const overflow = unique.length - visible.length;

  return (
    <div
      className={cn("lb-root lb-avatar-stack", className)}
      style={
        {
          "--lb-avatar-size": `${size}px`,
          "--lb-avatar-stack-gap": "2px",
        } as CSSProperties
      }
      aria-label={`${unique.length} viewing`}
    >
      {visible.map((u) => (
        <Avatar
          key={u.id}
          src={u.avatar}
          name={u.name ?? "Someone"}
          tooltip={u.name}
          style={{ width: size, height: size }}
        />
      ))}
      {overflow > 0 ? (
        <span
          className="lb-avatar lb-avatar-fallback"
          style={{ width: size, height: size }}
          title={`${overflow} more`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
