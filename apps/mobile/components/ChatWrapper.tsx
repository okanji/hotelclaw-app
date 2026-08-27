import type { Session } from "@supabase/supabase-js";
import React, {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chat, OverlayProvider, useCreateChatClient } from "stream-chat-expo";
import { AiPixelGrid, AiShimmerLabel } from "./AiLoader";
import { apiBaseUrl, chatApiKey } from "../chatConfig";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

const chatTheme = {
  channelPreview: {
    container: {
      backgroundColor: "transparent",
    },
  },
  messageComposer: {
    // The SDK hardcodes borderTopWidth: 1 on the composer wrapper, which
    // renders 2-3 physical px on retina — visibly heavier than the rest of
    // the chrome. The theme wrapper is applied after the inline style, so a
    // hairline here wins.
    wrapper: {
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  },
};

// How long to wait before telling the user which endpoint we're stuck on. The
// usual cause is EXPO_PUBLIC_API_URL pointing at a port nothing is serving.
const SLOW_CONNECT_MS = 8000;

// stream-chat's default HTTP timeout is 3000ms — aggressive for mobile
// networks. A send that exceeds it is marked FAILED (red exclamation on the
// bubble) even though the request usually lands server-side, and the mark
// only clears when the websocket echoes the delivered message back. Ten
// seconds keeps slow-but-successful sends in "sending" instead of flashing
// a false failure. Module-level constant: useCreateChatClient caches its
// options on first render, so the identity must never change.
const CHAT_CLIENT_OPTIONS = { timeout: 10_000 };

/**
 * Connects Stream as the signed-in Supabase user. Tokens are minted by the web
 * backend (`/api/stream/token`, Bearer-authenticated) with an expiry; passing a
 * provider function lets the Stream client re-fetch on expiry.
 *
 * A failed mint must never strand the app: `useCreateChatClient` simply leaves
 * the client null forever, which is indistinguishable from a slow connect, so
 * we surface the error with Retry / Sign out instead of spinning.
 */
const AuthedChat = ({
  session,
  onRetry,
  children,
}: {
  session: Session;
  onRetry: () => void;
  children: ReactNode;
}) => {
  const { signOut } = useAuth();
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  const userId = session.user.id;
  const userName =
    (session.user.user_metadata?.full_name as string | undefined) ??
    session.user.email ??
    userId;

  // Keep the provider identity stable — Stream re-invokes it on token expiry,
  // and a changing function would churn the client. `setTokenError` has stable
  // identity (useState setter), so the empty dep list is sound.
  const tokenProvider = useCallback(async () => {
    try {
      // Always read the freshest access token — the session prop may be stale
      // by the time Stream refreshes an expired chat token.
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const accessToken = current?.access_token;
      if (!accessToken) throw new Error("No Supabase session");
      const res = await fetch(`${apiBaseUrl}/api/stream/token`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Backend rejected the session (401)"
            : `Token endpoint returned ${res.status}`,
        );
      }
      const { token } = (await res.json()) as { token: string };
      setTokenError(null);
      return token;
    } catch (err) {
      // fetch() rejects with a bare "Network request failed" — name the target
      // so a wrong EXPO_PUBLIC_API_URL is obvious rather than mysterious.
      const message = err instanceof Error ? err.message : String(err);
      setTokenError(
        /network request failed/i.test(message)
          ? `Can't reach the backend at ${apiBaseUrl}`
          : message,
      );
      throw err;
    }
  }, []);

  const chatClient = useCreateChatClient({
    apiKey: chatApiKey,
    options: CHAT_CLIENT_OPTIONS,
    userData: { id: userId, name: userName },
    tokenOrProvider: tokenProvider,
  });

  useEffect(() => {
    if (chatClient) return;
    const timer = setTimeout(() => setSlow(true), SLOW_CONNECT_MS);
    return () => clearTimeout(timer);
  }, [chatClient]);

  if (!chatClient) {
    const problem = tokenError ?? (!chatApiKey ? "No Stream API key set" : null);

    if (problem) {
      return (
        <View style={styles.center}>
          <Text style={styles.title}>Can&apos;t connect to chat</Text>
          <Text style={styles.body}>{problem}</Text>
          <Text style={styles.hint}>
            The app mints its Stream token from the web backend. Check that it
            is running and that EXPO_PUBLIC_API_URL points at it.
          </Text>
          <Pressable style={styles.button} onPress={onRetry}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => void signOut()}>
            <Text style={styles.linkText}>Sign out</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.center}>
        <View style={styles.connectRow}>
          <AiPixelGrid />
          <AiShimmerLabel>Connecting to chat…</AiShimmerLabel>
        </View>
        {slow ? (
          <>
            <Text style={styles.hint}>
              Still waiting on {apiBaseUrl}. If that looks wrong, fix
              EXPO_PUBLIC_API_URL in apps/mobile/.env.local and reload.
            </Text>
            <Pressable style={styles.linkButton} onPress={() => void signOut()}>
              <Text style={styles.linkText}>Sign out</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <OverlayProvider value={{ style: chatTheme }}>
      <Chat client={chatClient}>{children}</Chat>
    </OverlayProvider>
  );
};

export const ChatWrapper = ({ children }: { children: ReactNode }) => {
  const { session } = useAuth();
  const [attempt, setAttempt] = useState(0);

  // Signed out: no chat connection — the login screen renders without it.
  if (!session) {
    return <>{children}</>;
  }

  // Key by user so switching accounts tears down the old client cleanly, and by
  // attempt so Retry rebuilds the client from scratch.
  return (
    <AuthedChat
      key={`${session.user.id}:${attempt}`}
      session={session}
      onRetry={() => setAttempt((a) => a + 1)}
    >
      {children}
    </AuthedChat>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  connectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  body: {
    fontSize: 15,
    color: "#374151",
    textAlign: "center",
  },
  hint: {
    fontSize: 13,
    color: "#6b7280",
    textAlign: "center",
  },
  button: {
    marginTop: 8,
    backgroundColor: "#111827",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  linkButton: {
    paddingVertical: 8,
  },
  linkText: {
    color: "#6b7280",
    fontSize: 14,
  },
});
