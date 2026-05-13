"use client";

import { useEffect, useRef, useState } from "react";
import {
  StreamVideoClient,
  StreamVideo,
} from "@stream-io/video-react-sdk";

type Props = {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  children: React.ReactNode;
};

/**
 * Stream Video & Audio client provider — mounts alongside StreamProvider
 * (Chat) so the same logged-in user can be in both at once. Token comes from
 * /api/stream/video-token (separate from the chat token, but signed with the
 * same secret).
 *
 * Strict-mode safe via the same pattern as client-provider.tsx:
 *   - new client per effect run, not a singleton (singletons survive
 *     unmount→remount in dev and keep stale state)
 *   - mounted guard + 50ms setTimeout so the second mount can cancel the
 *     first mid-flight
 *   - cleanup calls disconnectUser
 *   - deps include only token+userId; profile metadata changes are pushed
 *     into the live connection via a separate effect (avoids tearing down
 *     the call when the user edits their avatar)
 */
export function StreamVideoProvider({
  userId,
  userName,
  avatarUrl,
  children,
}: Props) {
  const [client, setClient] = useState<StreamVideoClient | null>(null);
  const [token, setToken] = useState<{ token: string; apiKey: string } | null>(
    null,
  );

  // Hold the latest user metadata so the connect effect doesn't restart on
  // profile edits.
  const identityRef = useRef({ userName, avatarUrl });
  identityRef.current = { userName, avatarUrl };

  // Step 1: fetch the token + api key once we know the user.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/stream/video-token", { cache: "no-store" })
      .then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(new Error(`video-token ${r.status}`)),
      )
      .then((j: { token: string; apiKey: string }) => {
        if (!cancelled) setToken({ token: j.token, apiKey: j.apiKey });
      })
      .catch((e) => console.error("Stream video token fetch failed", e));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Step 2: once the token arrives, connect.
  useEffect(() => {
    if (!token || !userId) return;
    let mounted = true;
    let connected: StreamVideoClient | null = null;

    const timer = setTimeout(async () => {
      if (!mounted) return;
      const { userName: latestName, avatarUrl: latestAvatar } =
        identityRef.current;
      const c = new StreamVideoClient({
        apiKey: token.apiKey,
        user: {
          id: userId,
          name: latestName,
          image: latestAvatar ?? undefined,
        },
        token: token.token,
      });
      // The constructor connects internally for the SDK; no explicit
      // connectUser call is required for an authenticated user that was
      // passed in the constructor.
      if (!mounted) {
        c.disconnectUser().catch(() => {});
        return;
      }
      connected = c;
      setClient(c);
    }, 50);

    return () => {
      mounted = false;
      clearTimeout(timer);
      connected?.disconnectUser().catch(() => {});
      setClient(null);
    };
  }, [token, userId]);

  // Don't block the tree on the video client — chat and the rest of the app
  // should keep working even if video isn't ready (or fails entirely). When
  // the client is null, we render children without a provider; the huddle
  // context will report "not ready" and the Huddle button will be disabled.
  if (!client) return <>{children}</>;
  return <StreamVideo client={client}>{children}</StreamVideo>;
}
