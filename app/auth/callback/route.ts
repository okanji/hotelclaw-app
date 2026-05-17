import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

/**
 * OAuth + magic-link `code` callback (PKCE).
 *
 * Same cookie-on-response trick as /auth/confirm: pre-allocate the redirect
 * so exchangeCodeForSession's cookies stick.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  // Pre-allocate. We'll mutate Location once we know where to go.
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

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const target = new URL("/login", origin);
      target.searchParams.set("error", error.message);
      response.headers.set("Location", target.toString());
      return response;
    }
  }

  // If next was passed (e.g. invite link), respect it.
  if (next) {
    response.headers.set("Location", new URL(next, origin).toString());
    return response;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    response.headers.set("Location", new URL("/login", origin).toString());
    return response;
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("property_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (!memberships || memberships.length === 0) {
    response.headers.set("Location", new URL("/onboarding", origin).toString());
  } else {
    response.headers.set(
      "Location",
      new URL(`/p/${memberships[0].property_id}/chat`, origin).toString(),
    );
  }
  return response;
}
