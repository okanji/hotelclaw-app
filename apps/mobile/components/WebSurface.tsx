import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { apiBaseUrl } from "../chatConfig";
import { supabase } from "../lib/supabase";
import { ErrorState } from "./ui";

/**
 * Renders a page from the web app inside the native shell, signed in as the
 * current user.
 *
 * Why a WebView at all: the document editor is Tiptap + Liveblocks, and
 * ProseMirror requires a browser DOM — it cannot run natively in React Native,
 * and Liveblocks' RN support covers presence/storage only, not text editors.
 * Embedding the real editor is what buys rich text, live collaboration,
 * presence, and every custom node (callout, toggle, chart, sub-page, embed)
 * without maintaining a second editor.
 *
 * Auth: the tokens are injected into the page's JS context BEFORE its scripts
 * run, and `/auth/mobile-bridge` exchanges them for the cookie session the web
 * app expects. Tokens never appear in a URL.
 */
export function WebSurface({ path }: { path: string }) {
  const [tokens, setTokens] = useState<{
    access_token: string;
    refresh_token: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        if (!session?.access_token || !session?.refresh_token) {
          setError("No session — sign in again.");
          setLoading(false);
          return;
        }
        setTokens({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => setAttempt((a) => a + 1)}
      />
    );
  }

  if (!tokens) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const uri = `${apiBaseUrl}/auth/mobile-bridge?next=${encodeURIComponent(path)}`;
  // Runs before the page's own scripts, on every navigation in this WebView.
  // The `data-hotelclaw-embed` attribute tells the web app it's inside the
  // native shell, so redundant chrome (the hamburger top bar — the native
  // header already owns navigation) hides via CSS (globals.css).
  const injected = `
    window.__HOTELCLAW_MOBILE_SESSION__ = ${JSON.stringify(tokens)};
    (function stamp() {
      if (document.documentElement) {
        document.documentElement.setAttribute("data-hotelclaw-embed", "1");
      } else {
        document.addEventListener("DOMContentLoaded", stamp, { once: true });
      }
    })();
    true;`;

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ uri }}
        injectedJavaScriptBeforeContentLoaded={injected}
        // The editor is collaborative: it needs storage, websockets, and a
        // keyboard that doesn't fight the native scroll view.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        originWhitelist={["*"]}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView={false}
        allowsBackForwardNavigationGestures={false}
        onLoadEnd={() => setLoading(false)}
        onError={({ nativeEvent }) =>
          setError(nativeEvent.description || "Failed to load")
        }
        onHttpError={({ nativeEvent }) => {
          if (nativeEvent.statusCode >= 500) {
            setError(`Server error (${nativeEvent.statusCode})`);
          }
        }}
        style={styles.web}
      />
      {loading ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  web: { flex: 1, backgroundColor: "#ffffff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
});
