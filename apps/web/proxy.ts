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
  // - /.well-known/workflow/* — the Workflow SDK's internal flow endpoint.
  //   Intercepting it corrupts the request body (detached ArrayBuffer) and
  //   silently breaks durable workflow execution in local dev (Next 16 proxy.ts
  //   gotcha, per node_modules/workflow/docs/getting-started/next.mdx).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|\\.well-known/workflow|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
