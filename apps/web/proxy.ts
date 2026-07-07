import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip middleware on:
  // - Static assets and Next.js internals
  // - /api/* — route handlers authenticate independently; running middleware
  //   here doubles getUser() calls and was costing 3-4s per Liveblocks auth.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
