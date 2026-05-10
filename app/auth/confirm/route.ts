import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

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
  const next = url.searchParams.get("next");

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      new URL("/login?error=missing-token", origin),
    );
  }

  // Pre-allocate the response so verifyOtp's session cookies stick to it.
  const response = NextResponse.redirect(new URL("/", origin));

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    const target = new URL("/login", origin);
    target.searchParams.set("error", error.message);
    response.headers.set("Location", target.toString());
    return response;
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
