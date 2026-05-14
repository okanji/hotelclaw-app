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
      authEndpoint="/api/liveblocks/auth"
      resolveUsers={resolveUsers}
      resolveMentionSuggestions={resolveMentionSuggestions}
    >
      {children}
    </LiveblocksProvider>
  );
}
