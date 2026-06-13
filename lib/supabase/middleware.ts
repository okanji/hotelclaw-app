import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Guest chatbot pages: public, no Supabase session — but they need a
  // per-bot frame-ancestors policy so the embed widget can iframe them ONLY
  // from the bot's allowed domains (empty allowlist = no embedding).
  if (request.nextUrl.pathname.startsWith("/g/")) {
    const slug = request.nextUrl.pathname.split("/")[2] ?? "";
    let frameAncestors = "'self'";
    if (/^[a-f0-9]{16,64}$/.test(slug)) {
      try {
        const service = createServiceClient();
        const { data } = await service
          .from("chatbots")
          .select("allowed_domains")
          .eq("public_slug", slug)
          .maybeSingle();
        const domains = (data?.allowed_domains ?? [])
          .map((d) => d.trim())
          .filter((d) => /^(https?:\/\/)?[a-z0-9.*:-]+$/i.test(d));
        if (domains.length > 0) frameAncestors += ` ${domains.join(" ")}`;
      } catch {
        // fail closed to 'self'
      }
    }
    response.headers.set(
      "Content-Security-Policy",
      `frame-ancestors ${frameAncestors}`,
    );
    return response;
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health") ||
    // Guest chatbot pages — anonymous hotel guests, identified by the bot's
    // unguessable slug + an HMAC session token, never a Supabase session.
    pathname.startsWith("/g/") ||
    // Public booking pages (/book/<property-slug> + signed manage links).
    pathname.startsWith("/book/") ||
    // The embed widget script loads on third-party hotel websites (the
    // root matcher only exempts image extensions, not .js).
    pathname === "/chatbot-widget.js" ||
    pathname === "/";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Property-scope guard for /[propertyId]/...
  const propertyMatch = pathname.match(/^\/p\/([^/]+)/);
  if (user && propertyMatch) {
    const propertyId = propertyMatch[1];
    const { data: membership } = await supabase
      .from("memberships")
      .select("property_id")
      .eq("property_id", propertyId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
