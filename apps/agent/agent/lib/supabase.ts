import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for the agent runtime. Tenant isolation does NOT rely on
// RLS here — every query must be scoped by the propertyId stamped on the
// session by channel auth (agent/channels/eve.ts), mirroring how the web
// app's service-client code paths work.
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
