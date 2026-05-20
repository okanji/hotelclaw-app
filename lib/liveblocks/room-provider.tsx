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
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? "Liveblocks auth failed");
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
