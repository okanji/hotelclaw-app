"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { StreamChat, type User } from "stream-chat";
import {
  Chat,
  ComponentProvider,
  useComponentContext,
} from "stream-chat-react";
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
    <ComponentProvider value={{ ...parent, MessageUI: SlackMessageUI }}>
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
  const { resolvedTheme } = useTheme();
  const streamTheme =
    resolvedTheme === "dark" ? "str-chat__theme-dark" : "str-chat__theme-light";

  // Step 1: fetch the token once when identity is known.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/stream/token", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`))))
      .then((j: { token: string }) => {
        if (!cancelled) setToken(j.token);
      })
      .catch((e) => console.error("Stream token fetch failed", e));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Step 2: once token arrives, connect — strict-mode safe.
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
    if (!apiKey || !token || !userId) return;

    let mounted = true;
    let connectedClient: StreamChat | null = null;

    const timer = setTimeout(async () => {
      if (!mounted) return;
      const c = new StreamChat(apiKey, { timeout: 15000 });
      const user: User = {
        id: userId,
        name: userName,
        image: avatarUrl ?? undefined,
      };
      try {
        await c.connectUser(user, token);
      } catch (e) {
        console.error("Stream connectUser failed", e);
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
  }, [token, userId, userName, avatarUrl]);

  // Children include components (ChannelList, CommandPalette, etc.) that call
  // useChatContext() on first render. Rendering them outside <Chat> triggers
  // a flood of "called outside the ChatContext provider" warnings, so we hold
  // the whole shell behind a minimal loading state until Stream is connected.
  if (!client) {
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
