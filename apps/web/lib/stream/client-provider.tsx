"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

export type StreamConnectionStatus = "connecting" | "ready" | "error";

export type StreamConnection = {
  /** The client instance. Exists from the first frame but is NOT connected
   *  until `status === "ready"` — never query through it before then. */
  client: StreamChat;
  status: StreamConnectionStatus;
  error: Error | null;
  /** Re-run token fetch + connectUser after a failure. */
  retry: () => void;
};

const StreamConnectionContext = createContext<StreamConnection | null>(null);

/** Connection state of the workspace Stream Chat client. */
export function useStreamConnection(): StreamConnection {
  const ctx = useContext(StreamConnectionContext);
  if (!ctx) {
    throw new Error("useStreamConnection must be used inside <StreamProvider>");
  }
  return ctx;
}

/** True once `connectUser` has resolved for the current user. */
export function useStreamReady(): boolean {
  return useStreamConnection().status === "ready";
}

/**
 * The Stream client, but only once a user is connected — `null` before that
 * (and while reconnecting after a retry). Drop-in for
 * `useChatContext().client` in components that query Stream: the existing
 * `if (!client)` guards then hold, and effects keyed on the client re-run the
 * moment the connection lands (the identity flips null → client).
 */
export function useConnectedStreamClient(): StreamChat | null {
  const { client, status } = useStreamConnection();
  return status === "ready" ? client : null;
}

/**
 * Renders `children` only once Stream is connected. Before that, `fallback`
 * (default: nothing); on a connect failure, `errorFallback` (default: the
 * inline "Couldn't connect to chat" + Retry).
 */
export function StreamReady({
  children,
  fallback = null,
  errorFallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  errorFallback?: React.ReactNode;
}) {
  const { status } = useStreamConnection();
  if (status === "ready") return <>{children}</>;
  if (status === "error") {
    return <>{errorFallback === undefined ? <StreamConnectError /> : errorFallback}</>;
  }
  return <>{fallback}</>;
}

/** "Couldn't connect to chat" + Retry, sized for wherever chat would be. */
export function StreamConnectError({ compact = false }: { compact?: boolean }) {
  const { error, retry } = useStreamConnection();
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
        <span>Couldn’t connect to chat.</span>
        <button
          type="button"
          onClick={retry}
          className="text-foreground underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-sm">
      <p className="text-muted-foreground">Couldn’t connect to chat.</p>
      {error ? (
        <p className="max-w-md text-center text-xs text-muted-foreground/80">
          {error.message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={retry}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-foreground hover:bg-foreground/[0.04]"
      >
        Retry
      </button>
    </div>
  );
}

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

async function fetchStreamToken(): Promise<string> {
  const r = await fetch("/api/stream/token", { cache: "no-store" });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = (await r.json()) as { token: string };
  return j.token;
}

/**
 * Client-side Stream Chat provider — NON-BLOCKING.
 *
 * The `StreamChat` instance is created synchronously on the first render, so
 * `<Chat>` wraps the whole shell from the first frame (no component ever
 * renders outside the ChatContext) while token fetch + `connectUser` run in
 * the background. Nothing here holds the shell: pieces that must not run
 * before a user is connected gate themselves on `useStreamReady()` /
 * `useConnectedStreamClient()` / `<StreamReady>` (exported above).
 *
 * Strict-mode / lifecycle rules (.agents/skills/stream/RULES.md):
 *   - `new StreamChat(apiKey)`, never `getInstance()` (a singleton survives
 *     strict-mode unmount→remount with stale state). It lives in a lazy
 *     `useState`, so React keeps exactly one instance per provider mount.
 *   - Because the instance is reused across attempts (strict-mode double
 *     effect, Retry, a userId change), every connect and disconnect is
 *     appended to ONE promise chain, so a disconnect from a torn-down attempt
 *     can never interleave with the next attempt's `connectUser`. A connect
 *     step whose effect was already cleaned up before it started is skipped —
 *     that's what makes the strict-mode double-invoke a no-op.
 *   - No `useRef` "run-once" guards — refs persist across the strict unmount.
 */
export function StreamProvider({
  userId,
  userName,
  avatarUrl,
  children,
}: Props) {
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const [client] = useState(
    () => new StreamChat(apiKey ?? "", { timeout: 15000 }),
  );
  // Bumped by Retry so the connect effect reruns.
  const [retryNonce, setRetryNonce] = useState(0);
  const attempt = `${userId}:${retryNonce}`;
  // Status is DERIVED from which attempt last succeeded / failed, so a new
  // attempt reads as "connecting" without a synchronous setState in the
  // effect.
  const [readyAttempt, setReadyAttempt] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    attempt: string;
    error: Error;
  } | null>(null);

  const { resolvedTheme } = useTheme();
  const streamTheme =
    resolvedTheme === "dark" ? "str-chat__theme-dark" : "str-chat__theme-light";

  // Hold the latest name/image in refs so profile edits don't retrigger the
  // connect effect below — the server already calls upsertStreamUser, and a
  // mid-flight router.refresh() reconnect tears down channels that components
  // are still watching ("channel after disconnect").
  const identityRef = useRef({ userName, avatarUrl });
  useEffect(() => {
    identityRef.current = { userName, avatarUrl };
  }, [userName, avatarUrl]);

  // Serialises connect/disconnect on the shared client (see doc comment).
  const opChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!userId) return;
    let mounted = true;

    opChain.current = opChain.current.then(async () => {
      if (!mounted) return;
      try {
        if (!apiKey) throw new Error("NEXT_PUBLIC_STREAM_API_KEY is not set");
        const token = await fetchStreamToken();
        if (!mounted) return;
        const { userName: latestName, avatarUrl: latestAvatar } =
          identityRef.current;
        const user: User = {
          id: userId,
          name: latestName,
          image: latestAvatar ?? undefined,
        };
        await client.connectUser(user, token);
      } catch (e) {
        console.error("Stream connect failed", e);
        if (mounted) {
          setFailure({
            attempt,
            error: e instanceof Error ? e : new Error(String(e)),
          });
        }
        return;
      }
      // A torn-down attempt that connected anyway is undone by the
      // disconnect its cleanup queued right behind this step.
      if (mounted) setReadyAttempt(attempt);
    });

    return () => {
      mounted = false;
      // Fast Refresh / a re-run with the same attempt key would otherwise
      // keep reading "ready" across the disconnect→reconnect window.
      setReadyAttempt(null);
      opChain.current = opChain.current
        .then(() => client.disconnectUser())
        .catch(() => {});
    };
  }, [client, apiKey, userId, attempt]);

  const status: StreamConnectionStatus =
    readyAttempt === attempt
      ? "ready"
      : failure?.attempt === attempt
        ? "error"
        : "connecting";
  const ready = status === "ready";

  // Profile edits (name/avatar) — push the new metadata into the live
  // connection without reconnecting. Stream propagates this as a user.updated
  // event to everyone subscribed to channels with this user.
  useEffect(() => {
    if (!ready) return;
    client
      .partialUpdateUser(
        avatarUrl
          ? { id: userId, set: { name: userName, image: avatarUrl } }
          : { id: userId, set: { name: userName }, unset: ["image"] },
      )
      .catch((e) => console.error("Stream partialUpdateUser failed", e));
  }, [ready, client, userId, userName, avatarUrl]);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);
  const connection = useMemo<StreamConnection>(
    () => ({
      client,
      status,
      error: status === "error" ? (failure?.error ?? null) : null,
      retry,
    }),
    [client, status, failure, retry],
  );

  return (
    <StreamConnectionContext.Provider value={connection}>
      <Chat client={client} theme={streamTheme}>
        <StreamChatComponents>{children}</StreamChatComponents>
      </Chat>
    </StreamConnectionContext.Provider>
  );
}
