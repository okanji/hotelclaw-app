import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components can't set cookies; middleware handles refresh.
          }
        },
      },
    },
  );
}

/**
 * A WebSocket constructor for supabase-js's realtime client.
 *
 * `new SupabaseClient()` ALWAYS constructs a RealtimeClient, and realtime-js
 * resolves a WebSocket constructor eagerly while doing so — it probes for a
 * global `WebSocket`, then sniffs `process.versions.node`, then throws
 * "Unknown JavaScript runtime without WebSocket support."
 *
 * Inside the Vercel Workflow durable-runtime bundle there is neither: no
 * global WebSocket and no `process`. So every `createServiceClient()` call in
 * that bundle threw, and since `runWorkflowSpec` builds the org scope before
 * the first step, EVERY durable workflow died before doing anything — which
 * is every `schedule.cron` workflow, since classifyMode always routes those
 * to the durable runtime (found 2026-08-14 by the first scheduled workflow
 * this codebase ever had).
 *
 * Server code never opens a realtime channel, so the stub is never
 * constructed; it exists to satisfy the eager probe. If something ever does
 * try, it fails loudly rather than silently pretending to subscribe.
 */
function realtimeTransport() {
  const existing = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof existing !== "undefined") return existing;
  return class UnavailableWebSocket {
    constructor() {
      throw new Error(
        "Supabase realtime is not available in this runtime. Server-side code should poll or use postgres_changes from the browser.",
      );
    }
  };
}

export function createServiceClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      realtime: { transport: realtimeTransport() as never },
    },
  );
}
