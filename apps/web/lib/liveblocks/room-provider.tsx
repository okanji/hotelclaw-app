"use client";

import { LiveblocksProvider } from "@liveblocks/react/suspense";
import { resolveMentionSuggestions, resolveUsers } from "./resolvers";

export function LiveblocksProviders({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  return (
    <LiveblocksProvider
      authEndpoint={async (room) => {
        const res = await fetch("/api/liveblocks/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room }),
        });
        if (!res.ok) {
          // Liveblocks' contract is that the callback throws on failure — it
          // surfaces the throw via useStatus() so RoomProvider renders its
          // connection-state UI. We still log with full context so dev/prod
          // logs show *why* the auth failed (401 vs 403 vs 500), which the
          // thrown message alone doesn't capture.
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          console.error("[liveblocks] auth endpoint failed", {
            propertyId,
            room,
            status: res.status,
            error: err.error,
          });
          throw new Error(
            `Liveblocks auth failed (${res.status})${
              err.error ? `: ${err.error}` : ""
            }`,
          );
        }
        return res.json();
      }}
      resolveUsers={resolveUsers}
      resolveMentionSuggestions={resolveMentionSuggestions}
    >
      {children}
    </LiveblocksProvider>
  );
}
