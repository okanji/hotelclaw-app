import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { safeNextPath } from "@/lib/auth/safe-next";

/**
 * Email-OTP confirmation endpoint, per Supabase's PKCE flow.
 * Email templates link here: `?token_hash={{ .TokenHash }}&type=...`.
 *
 * IMPORTANT: We build the redirect response *first* and attach session cookies
 * to *it* (rather than relying on `cookies().set()` propagation). In Next 16
 * Route Handlers, cookies set via `cookies()` don't reliably persist onto a
 * freshly-created `NextResponse.redirect()` — so users would click the email
 * link, verifyOtp would succeed, and then the next request would still be
 * unauthenticated. This pattern is what `lib/supabase/middleware.ts` uses too.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  // Legacy/default-template links arrive as `?code=` (Supabase's /verify with
  // PKCE): exchanged below instead of verified. Same-browser only — the PKCE
  // verifier cookie must exist — but it rescues emails sent before the
  // token_hash templates were pushed.
  const code = url.searchParams.get("code");
  // Sanitized: only same-origin paths — a raw `next` here was an open
  // redirect on the very URL all auth emails link to.
  const next = safeNextPath(url.searchParams.get("next"));

  if ((!tokenHash || !type) && !code) {
    return NextResponse.redirect(
      new URL("/login?error=missing-token", origin),
    );
  }

  // Pre-allocate the response so verifyOtp's session cookies stick to it.
  const response = NextResponse.redirect(new URL("/", origin));

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Whoever was signed in BEFORE this link replaces the session — an email
  // link opened in a browser that's already signed in as someone else swaps
  // accounts silently, which has repeatedly confused people. Capture the
  // outgoing identity so we can announce the switch after verification.
  const {
    data: { user: previousUser },
  } = await supabase.auth.getUser();

  const { error } =
    tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.exchangeCodeForSession(code!);

  if (error) {
    const target = new URL("/login", origin);
    target.searchParams.set("error", error.message);
    // Keep the destination: an invite link whose one-time token has gone
    // stale should still land the user on the invite after a manual sign-in.
    if (next) target.searchParams.set("next", next);
    response.headers.set("Location", target.toString());
    return response;
  }

  // Announce a silent account swap: JS-readable one-shot cookie that
  // AccountSwitchNotice (root layout) turns into a toast and clears.
  const {
    data: { user: newUser },
  } = await supabase.auth.getUser();
  if (previousUser && newUser && previousUser.id !== newUser.id) {
    response.cookies.set(
      "account_switched",
      JSON.stringify({ from: previousUser.email, to: newUser.email }),
      { path: "/", maxAge: 60, httpOnly: false, sameSite: "lax" },
    );
  }

  // Recovery → set new password page.
  if (type === "recovery") {
    response.headers.set(
      "Location",
      new URL("/update-password", origin).toString(),
    );
    return response;
  }

  // If a `next` was provided (e.g. /invites/{token} for invite accept), honor it.
  if (next) {
    response.headers.set("Location", new URL(next, origin).toString());
    return response;
  }

  // Default landing: root redirects to onboarding or last property.
  return response;
}
