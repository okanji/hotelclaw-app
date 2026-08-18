import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { apiBaseUrl } from "../chatConfig";
import { apiFetch } from "../lib/api";
import { ErrorState } from "./ui";

// Origin the session tokens are allowed to reach. Everything the WebView is
// for lives on the web app; any other origin gets opened in the system
// browser instead (see onShouldStartLoadWithRequest below).
const API_ORIGIN = new URL(apiBaseUrl).origin;

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
 * Auth: a ONE-TIME login hash (minted by `/api/auth/mobile-session`, Bearer
 * auth) is injected into the page's JS context BEFORE its scripts run, and
 * `/auth/mobile-bridge` exchanges it for a cookie session OF ITS OWN. The
 * native refresh token never enters the WebView: sharing it let the web
 * client rotate the refresh-token family out from under the native app,
 * which signed the whole app out after a document had been opened (caught
 * live in the 2026-08-18 smoke test). Nothing sensitive appears in a URL.
 *
 * SECURITY: the injected script runs on EVERY main-frame navigation in this
 * WebView, at any origin — so the tokens must never be planted on a page we
 * don't control. Two layers enforce that:
 *  1. The script itself only defines the session global when
 *     `location.origin` matches the web app's origin.
 *  2. `onShouldStartLoadWithRequest` refuses to navigate the main frame
 *     anywhere off-origin — external links open in the system browser, where
 *     no injection happens. Iframes (doc embeds: YouTube, Figma, …) are
 *     allowed through; the injection is main-frame-only.
 */
export function WebSurface({ path }: { path: string }) {
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ token_hash: string }>("/api/auth/mobile-session", {
      method: "POST",
    })
      .then((res) => {
        if (cancelled) return;
        if (!res.token_hash) {
          setError("No session — sign in again.");
          setLoading(false);
          return;
        }
        setTokenHash(res.token_hash);
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
        onRetry={() => {
          setError(null);
          setLoading(true);
          setTokenHash(null);
          setAttempt((a) => a + 1);
        }}
      />
    );
  }

  if (!tokenHash) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const uri = `${apiBaseUrl}/auth/mobile-bridge?next=${encodeURIComponent(path)}`;
  // Runs before the page's own scripts, on every navigation in this WebView.
  // The origin check is layer 1 of the token containment (see header comment).
  // The `data-hotelclaw-embed` attribute tells the web app it's inside the
  // native shell, so redundant chrome (the hamburger top bar — the native
  // header already owns navigation) hides via CSS (globals.css).
  const injected = `
    if (location.origin === ${JSON.stringify(API_ORIGIN)}) {
      window.__HOTELCLAW_MOBILE_OTP__ = ${JSON.stringify({ token_hash: tokenHash })};
    }
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
        // Defense-in-depth default; the injection is main-frame-only either
        // way, but keep it explicit so a future edit can't silently widen it.
        injectedJavaScriptForMainFrameOnly
        // Layer 2 of the token containment: main-frame navigation never
        // leaves our origin. External links open in the system browser.
        onShouldStartLoadWithRequest={(request) => {
          // Iframes (embeds inside documents) are not the main frame and
          // never see the injected global — let them load.
          if (request.isTopFrame === false) return true;
          if (
            request.url.startsWith(`${API_ORIGIN}/`) ||
            request.url === API_ORIGIN ||
            request.url.startsWith("about:")
          ) {
            return true;
          }
          if (/^https?:\/\//i.test(request.url)) {
            Linking.openURL(request.url).catch(() => {});
          }
          return false;
        }}
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
