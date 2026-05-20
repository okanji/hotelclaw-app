"use client";

import { useEffect } from "react";
import { LiveblocksProvider } from "@liveblocks/react/suspense";
import { resolveMentionSuggestions, resolveUsers } from "./resolvers";

export function LiveblocksProviders({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  // Pre-warm `/api/liveblocks/auth` so Turbopack has the route compiled by
  // the time Liveblocks's client makes its first auth call. Without this,
  // the very first request on a hard refresh triggers an on-demand compile
  // of the auth handler + all its transitive deps (Supabase server,
  // `@liveblocks/node`, etc.) — routinely 5–10s on a cold dev server. That
  // pushes past Liveblocks's internal `AUTH_TIMEOUT` (10s, see
  // @liveblocks/core), which surfaces as "Authentication failed: Timed out
  // during auth" and leaves `useIsEditorReady` stuck on false until the
  // user navigates to another doc (which forces a retry, by which point
  // the route is already compiled).
  //
  // This effect fires on the LiveblocksProvider's mount — before any
  // RoomProvider gets a chance to enter a room — so the compile happens in
  // parallel with the rest of the page hydration. We don't care about the
  // response (it'll typically 401 with no body since this fires before any
  // user action), only that the handler is bundled and ready.
  //
  // Production note: this is a no-op there — routes are pre-built, the
  // first call returns in milliseconds anyway. Cost is one extra HTTP
  // round-trip per property load.
  useEffect(() => {
    fetch("/api/liveblocks/auth", { method: "POST" }).catch(() => {});
  }, []);

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
