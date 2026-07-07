"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { StreamChat, type User } from "stream-chat";
import {
  Chat,
  ComponentProvider,
  useComponentContext,
} from "stream-chat-react";
import { SlackAttachment } from "@/components/chat/slack-attachment";
import { SlackDateSeparator } from "@/components/chat/slack-date-separator";
import { SlackMessageUI } from "@/components/chat/slack-message-ui";

type Props = {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  children: React.ReactNode;
};

/** Slack-style message row (avatars + alignment); merges with existing overrides from sidebar loaders etc. */
function StreamChatComponents({
  children,
}: {
  children: React.ReactNode;
}) {
  const parent = useComponentContext();
  return (
    <ComponentProvider
      value={{
        ...parent,
        Attachment: SlackAttachment,
        DateSeparator: SlackDateSeparator,
        MessageUI: SlackMessageUI,
      }}
    >
      {children}
    </ComponentProvider>
  );
}

/**
 * Client-side Stream Chat provider.
 *
 * Per Stream's strict-mode rules (.agents/skills/stream/RULES.md):
 *   - Use `new StreamChat(apiKey)` on the client, NOT `getInstance()`
 *     (singletons survive strict-mode unmount→remount and keep stale state).
 *   - Wrap connectUser() in `setTimeout(50ms)` + `let mounted` guard so the
 *     synchronous-then-async flow can be cancelled mid-flight when the second
 *     mount tears the first down.
 *   - Do NOT use `useRef` "run-once" guards — refs persist across the strict
 *     unmount, so the second mount would skip init entirely.
 */
export function StreamProvider({
  userId,
  userName,
  avatarUrl,
  children,
}: Props) {
  const [client, setClient] = useState<StreamChat | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<Error | null>(null);
  // Bumped by the retry button so the token-fetch and connect effects rerun.
  const [retryNonce, setRetryNonce] = useState(0);
  const { resolvedTheme } = useTheme();
  const streamTheme =
    resolvedTheme === "dark" ? "str-chat__theme-dark" : "str-chat__theme-light";

  // Hold the latest name/image in refs so profile edits don't retrigger the
  // connect effect below — the server already calls upsertStreamUser, and a
  // mid-flight router.refresh() reconnect tears down channels that components
  // are still watching ("channel after disconnect").
  const identityRef = useRef({ userName, avatarUrl });
  identityRef.current = { userName, avatarUrl };

  // Step 1: fetch the token once when identity is known.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/stream/token", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`))))
      .then((j: { token: string }) => {
        if (!cancelled) setToken(j.token);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Stream token fetch failed", e);
        setConnectError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, retryNonce]);

  // Step 2: once token arrives, connect — strict-mode safe.
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
    if (!apiKey || !token || !userId) return;

    let mounted = true;
    let connectedClient: StreamChat | null = null;

    const timer = setTimeout(async () => {
      if (!mounted) return;
      const c = new StreamChat(apiKey, { timeout: 15000 });
      const { userName: latestName, avatarUrl: latestAvatar } =
        identityRef.current;
      const user: User = {
        id: userId,
        name: latestName,
        image: latestAvatar ?? undefined,
      };
      try {
        await c.connectUser(user, token);
      } catch (e) {
        console.error("Stream connectUser failed", e);
        if (mounted) {
          setConnectError(e instanceof Error ? e : new Error(String(e)));
        }
        return;
      }
      if (!mounted) {
        c.disconnectUser().catch(() => {});
        return;
      }
      connectedClient = c;
      setClient(c);
    }, 50);

    return () => {
      mounted = false;
      clearTimeout(timer);
      connectedClient?.disconnectUser().catch(() => {});
      setClient(null);
    };
  }, [token, userId, retryNonce]);

  const handleRetry = () => {
    setConnectError(null);
    setToken(null);
    setRetryNonce((n) => n + 1);
  };

  // Profile edits (name/avatar) — push the new metadata into the live
  // connection without reconnecting. Stream propagates this as a user.updated
  // event to everyone subscribed to channels with this user.
  useEffect(() => {
    if (!client) return;
    client
      .partialUpdateUser(
        avatarUrl
          ? { id: userId, set: { name: userName, image: avatarUrl } }
          : { id: userId, set: { name: userName }, unset: ["image"] },
      )
      .catch((e) => console.error("Stream partialUpdateUser failed", e));
  }, [client, userId, userName, avatarUrl]);

  // Children include components (ChannelList, CommandPalette, etc.) that call
  // useChatContext() on first render. Rendering them outside <Chat> triggers
  // a flood of "called outside the ChatContext provider" warnings, so we hold
  // the whole shell behind a minimal loading state until Stream is connected.
  if (!client) {
    if (connectError) {
      return (
        <div className="flex h-svh flex-col items-center justify-center gap-3 text-sm">
          <p className="text-muted-foreground">Couldn’t connect to chat.</p>
          <p className="max-w-md text-center text-xs text-muted-foreground/80">
            {connectError.message}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-foreground hover:bg-foreground/[0.04]"
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
        Connecting…
      </div>
    );
  }
  return (
    <Chat client={client} theme={streamTheme}>
      <StreamChatComponents>{children}</StreamChatComponents>
    </Chat>
  );
}
