import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
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
export function WebSurface({
  path,
  onRequestBack,
}: {
  path: string;
  /**
   * When set, the embedded page may post `{type:"back"}` (the doc editor's
   * embed-only back chevron does) and it lands here — the web page can't pop
   * the native stack itself. Also gives the pre-WebView states (spinner /
   * error) a native way out.
   */
  onRequestBack?: () => void;
}) {
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

  // The document screen hides the native stack header (the embedded page
  // carries its own bar), so the states rendered BEFORE that bar exists need
  // their own way back.
  const backRow = onRequestBack ? (
    <Pressable
      onPress={onRequestBack}
      hitSlop={8}
      style={styles.backRow}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={24} color="#111827" />
    </Pressable>
  ) : null;

  if (error) {
    return (
      <View style={styles.container}>
        {backRow}
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setLoading(true);
            setTokenHash(null);
            setAttempt((a) => a + 1);
          }}
        />
      </View>
    );
  }

  if (!tokenHash) {
    return (
      <View style={styles.container}>
        {backRow}
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
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
    // Pin the page scale (Notion-app behavior). Without maximum-scale,
    // WebKit auto-zooms the whole page when a tap focuses editable text
    // rendered under 16px — "tap a doc and it zooms" — and double-tap
    // smart-zoom is live too. Scoped to the native shell only, so real
    // browsers keep pinch/accessibility zoom. The meta doesn't exist yet
    // when this runs (before content loads), so apply on DOMContentLoaded;
    // mutating the tag re-triggers viewport processing.
    (function pinViewport() {
      var PIN =
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
      function apply() {
        if (!document.head) return;
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
          meta = document.createElement("meta");
          meta.setAttribute("name", "viewport");
          document.head.appendChild(meta);
        }
        // Guard against loops: only write when the pin is actually gone.
        if (meta.getAttribute("content") !== PIN) {
          meta.setAttribute("content", PIN);
        }
      }
      function start() {
        apply();
        // Next's metadata reconciler can rewrite the viewport tag on
        // client-side navigations (restoring its unpinned default), which
        // would quietly re-enable tap-to-zoom mid-session — re-apply
        // whenever the head's meta set changes.
        new MutationObserver(apply).observe(document.head, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["content"],
        });
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
      } else {
        start();
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
        onMessage={(event) => {
          // Only shape we accept from the page; anything else is ignored.
          // Worst case for a hostile frame is a back-navigation — harmless.
          if (!onRequestBack) return;
          try {
            const data = JSON.parse(event.nativeEvent.data) as {
              type?: string;
            };
            if (data.type === "back") onRequestBack();
          } catch {
            // Non-JSON messages aren't ours.
          }
        }}
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
  backRow: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
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
