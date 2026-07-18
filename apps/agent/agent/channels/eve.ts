import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { createServerClient } from "@supabase/ssr";
import { serviceClient } from "../lib/supabase";

// The property the caller wants to work in. Verified against memberships
// below — the header only *selects* among the caller's real properties.
const PROPERTY_HEADER = "x-hotelclaw-property";
// Service-caller only: which user the session acts as.
const USER_HEADER = "x-hotelclaw-user";
// Which stored agent (agents table) this session speaks to. Existence +
// property ownership are verified in agent-config.ts resolvers; carrying a
// bogus id just means the static fallback instructions apply.
const AGENT_HEADER = "x-hotelclaw-agent";
// Which pod bot (bots table, fleet spec) this session addresses. Verified
// against the property's client in lib/pods.ts; bogus slugs resolve to no
// bot and the base runtime persona applies.
const BOT_HEADER = "x-hotelclaw-bot";

async function verifyMembership(
  userId: string,
  propertyId: string,
): Promise<{ role: string } | null> {
  const { data } = await serviceClient()
    .from("memberships")
    .select("role")
    .eq("property_id", propertyId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

function principal(
  authenticator: string,
  userId: string,
  propertyId: string,
  role: string,
  agentId: string | null,
  botSlug: string | null = null,
) {
  return {
    authenticator,
    issuer: "hotelclaw",
    principalId: userId,
    principalType: "user" as const,
    subject: userId,
    attributes: {
      propertyId,
      role,
      ...(agentId ? { agentId } : {}),
      ...(botSlug ? { botSlug } : {}),
    },
  };
}

// Browser path: the same-origin Supabase session cookie Next.js already
// sends on every request. Verified via the auth server (getUser), then the
// selected property is checked against memberships.
function supabaseCookieAuth(): AuthFn<Request> {
  return async (request) => {
    const propertyId = request.headers.get(PROPERTY_HEADER);
    const cookieHeader = request.headers.get("cookie");
    if (!propertyId || !cookieHeader) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anonKey) return null;

    const cookies = cookieHeader.split(/;\s*/).flatMap((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return [];
      return [
        {
          name: pair.slice(0, eq),
          value: decodeURIComponent(pair.slice(eq + 1)),
        },
      ];
    });

    const supabase = createServerClient(url, anonKey, {
      cookies: { getAll: () => cookies, setAll: () => {} },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const membership = await verifyMembership(user.id, propertyId);
    if (!membership) return null;

    return principal(
      "supabase-session",
      user.id,
      propertyId,
      membership.role,
      request.headers.get(AGENT_HEADER),
      request.headers.get(BOT_HEADER),
    );
  };
}

// Server-to-server path (dev harness + future internal delegation): the
// service-role key as a bearer plus explicit user/property headers. The
// membership check still applies — the service caller can only act as a
// user inside a property that user belongs to.
function serviceBearerAuth(): AuthFn<Request> {
  return async (request) => {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const auth = request.headers.get("authorization");
    if (!secret || !auth?.startsWith("Bearer ")) return null;
    const bearer = auth.slice(7);

    // Composite form `<serviceKey>:<propertyId>:<userId>[:<botSlug>]` lets
    // header-less callers (eve eval via EVE_EVAL_AUTH_TOKEN) carry the full
    // tenancy context in the bearer. Plain form still uses headers.
    let propertyId: string | null;
    let userId: string | null;
    let compositeBot: string | null = null;
    if (bearer === secret) {
      propertyId = request.headers.get(PROPERTY_HEADER);
      userId = request.headers.get(USER_HEADER);
    } else if (bearer.startsWith(`${secret}:`)) {
      const parts = bearer.slice(secret.length + 1).split(":");
      propertyId = parts[0] ?? null;
      userId = parts[1] ?? null;
      compositeBot = parts[2] ?? null;
    } else {
      return null;
    }
    if (!propertyId || !userId) return null;

    const membership = await verifyMembership(userId, propertyId);
    if (!membership) return null;

    return principal(
      "service-bearer",
      userId,
      propertyId,
      membership.role,
      request.headers.get(AGENT_HEADER),
      compositeBot ?? request.headers.get(BOT_HEADER),
    );
  };
}

// localDev() stays last for bare local smoke tests (no property attributes →
// dynamic resolvers fall back to static instructions). Replace with a
// fail-closed list before production exposure.
export default eveChannel({
  auth: [supabaseCookieAuth(), serviceBearerAuth(), localDev()],
});
