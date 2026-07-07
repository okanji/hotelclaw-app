"use client";

import { useEffect, useState } from "react";
import { useChatContext } from "stream-chat-react";
import { cn } from "@/lib/utils";

/**
 * Small banner that surfaces Stream Chat connection drops. Without this the
 * user has no visibility when chat goes offline — messages just silently
 * stop arriving and new sends queue without feedback.
 *
 * Subscribes to Stream's `connection.changed` event (also `connection.recovered`)
 * for the always-connected workspace client. Liveblocks status is per-room and
 * only mounted when a doc/task/calendar room is open, so it's tracked inside
 * those room providers if needed — not here.
 */
export function ConnectionStatus() {
  const { client } = useChatContext();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!client) return;
    // `connection.changed` fires with `{ online: boolean }`.
    const off = client.on("connection.changed", (event) => {
      const next = (event as unknown as { online?: boolean }).online;
      if (typeof next === "boolean") setOnline(next);
    });
    return () => {
      off?.unsubscribe?.();
    };
  }, [client]);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-4 z-50 mx-auto w-fit",
        "rounded-md bg-foreground/90 px-3 py-1.5 text-xs text-background shadow-md",
      )}
    >
      Reconnecting…
    </div>
  );
}
