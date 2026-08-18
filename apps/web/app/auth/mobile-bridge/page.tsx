"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Establishes a cookie session inside the mobile app's WebView.
 *
 * The native app authenticates with a Supabase Bearer token, but the web app
 * (and Liveblocks auth, and every server component) reads a cookie session. So
 * the document editor can't just be loaded in a WebView — it would bounce to
 * /login. This page takes the native session, calls `setSession` with the
 * browser client (which writes the `sb-*` cookies), and forwards to the real
 * page.
 *
 * The tokens arrive via a global that React Native injects with
 * `injectedJavaScriptBeforeContentLoaded` — deliberately NOT query params,
 * which would land in server logs, the Referer header, and history.
 */
declare global {
  interface Window {
    /** One-time magic-link hash from /api/auth/mobile-session (current). */
    __HOTELCLAW_MOBILE_OTP__?: {
      token_hash?: string;
    };
    /** Legacy token handoff from older app builds. Sharing the native
     * refresh token lets the WebView rotate it out from under the app
     * (refresh-token families), eventually signing the app out — kept only
     * so an outdated native build still opens documents. */
    __HOTELCLAW_MOBILE_SESSION__?: {
      access_token?: string;
      refresh_token?: string;
    };
  }
}

/** Only ever forward to a path on this origin. */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function MobileBridgePage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    const otp = window.__HOTELCLAW_MOBILE_OTP__;
    const tokens = window.__HOTELCLAW_MOBILE_SESSION__;

    const supabase = createClient();

    // Preferred path: exchange the one-time hash for a session of its own —
    // a separate refresh-token family from the native app's session.
    const establish = otp?.token_hash
      ? supabase.auth.verifyOtp({ type: "magiclink", token_hash: otp.token_hash })
      : tokens?.access_token && tokens?.refresh_token
        ? supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          })
        : Promise.reject(new Error("No session was handed to the app view."));

    establish
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError(sessionError.message);
          return;
        }
        // replace(), not assign() — the bridge must not sit in WebView history
        // where a back gesture would re-run it.
        window.location.replace(next);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100dvh",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#6b7280",
        fontSize: 15,
        textAlign: "center",
      }}
    >
      {error ? `Couldn't open this: ${error}` : "Opening…"}
    </div>
  );
}
