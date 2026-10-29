import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

export type ApiCaller = {
  supabase: SupabaseClient<Database>;
  user: User | null;
  /** True when the caller authenticated with a Bearer token (mobile). */
  isBearer: boolean;
};

/**
 * Resolve an API caller from either the Supabase session cookie (web) or an
 * `Authorization: Bearer <supabase access token>` header (mobile, which has no
 * cookies).
 *
 * Both paths return a client that runs queries AS THAT USER, so RLS still
 * applies — the Bearer path is an authentication shortcut, never an
 * authorization one. Extracted from the Stream token route so every
 * mobile-reachable endpoint resolves callers identically.
 */
export async function resolveApiCaller(request: Request): Promise<ApiCaller> {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];

  if (bearer) {
    const supabase = createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser(bearer);
    return { supabase, user, isBearer: true };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user, isBearer: false };
}

/**
 * Is the caller a FULL member (owner / manager / staff) of the property?
 * The cookie-or-Bearer twin of `requireFullMember` for routes reached from
 * mobile. Guests (0118) answer false: their membership row opens the
 * property, but full-member surfaces (AI panels, triage, channel AI
 * settings) act beyond any one grant.
 */
export async function callerIsFullMember(
  supabase: SupabaseClient<Database>,
  userId: string,
  propertyId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", propertyId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "owner" || data?.role === "manager" || data?.role === "staff";
}
