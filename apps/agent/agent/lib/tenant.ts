import type { SessionContext } from "eve/context";

export type TenantCaller = {
  propertyId: string;
  userId: string;
  role: string;
};

// The verified tenant scope for the current session. Comes from channel auth
// (agent/channels/eve.ts) — never from a prompt or tool argument.
// Root-session tenant memo: every successful direct resolution records
// sessionId -> tenant so subagent child sessions (which carry no channel
// auth — see resolveTenantCaller) can recover scope via
// ctx.session.parent.rootSessionId within the same runtime process. The
// durable Supabase lookup below covers cross-process cases (prod workflow
// world); this map covers sessions nothing records (evals, ad-hoc API
// sessions). Bounded FIFO — tenancy hints, not state.
const rootTenantMemo = new Map<string, TenantCaller>();
const ROOT_TENANT_MEMO_MAX = 500;

function memoTenant(sessionId: string | undefined, caller: TenantCaller) {
  if (!sessionId) return;
  if (rootTenantMemo.size >= ROOT_TENANT_MEMO_MAX) {
    const oldest = rootTenantMemo.keys().next().value;
    if (oldest !== undefined) rootTenantMemo.delete(oldest);
  }
  rootTenantMemo.set(sessionId, caller);
}

export function requireTenantCaller(ctx: SessionContext): TenantCaller {
  const caller = ctx.session.auth.current;
  const propertyId = caller?.attributes?.propertyId;
  const role = caller?.attributes?.role;
  if (!caller || typeof propertyId !== "string") {
    throw new Error(
      "An authenticated property member is required for this session.",
    );
  }
  const resolved = {
    propertyId,
    userId: caller.principalId,
    role: typeof role === "string" ? role : "staff",
  };
  memoTenant(ctx.session.id, resolved);
  return resolved;
}

export function tenantCallerOrNull(ctx: SessionContext): TenantCaller | null {
  try {
    return requireTenantCaller(ctx);
  } catch {
    return null;
  }
}

/**
 * Tenant scope for tools that may run inside SUBAGENT child sessions.
 *
 * Eve's documented behavior (docs/guides/auth-and-route-protection.md):
 * `auth.current`/`auth.initiator` are null on internal runtime paths —
 * subagent child sessions never went through channel auth. The child does
 * carry `ctx.session.parent.rootSessionId` (docs/guides/session-context.md),
 * and every ROOT session we create is recorded server-side at creation time
 * (agent_sessions / bot_chat_sessions, written with the service client from
 * verified request auth). Resolving tenancy from that record keeps the
 * scope server-bound — never from prompts or tool args.
 *
 * The chat/workflow fallback identity carries PROPERTY scope only (no
 * member user id) — fine for the read-only subagent tools; anything that
 * writes on behalf of a user must run in the root session.
 */
export async function resolveTenantCaller(
  ctx: SessionContext,
): Promise<TenantCaller> {
  const direct = tenantCallerOrNull(ctx);
  if (direct) return direct;

  const parent = (ctx.session as unknown as {
    parent?: { sessionId?: string; rootSessionId?: string };
  }).parent;
  const rootId = parent?.rootSessionId ?? parent?.sessionId;
  if (rootId) {
    const memoized =
      rootTenantMemo.get(rootId) ??
      (parent?.sessionId ? rootTenantMemo.get(parent.sessionId) : undefined);
    if (memoized) return memoized;
    const { serviceClient } = await import("./supabase");
    const sb = serviceClient();
    const { data: agentSession } = await sb
      .from("agent_sessions")
      .select("property_id, user_id")
      .eq("id", rootId)
      .maybeSingle();
    if (agentSession) {
      return {
        propertyId: agentSession.property_id as string,
        userId: agentSession.user_id as string,
        role: "staff",
      };
    }
    const { data: botSession } = await sb
      .from("bot_chat_sessions")
      .select("property_id")
      .eq("eve_session_id", rootId)
      .maybeSingle();
    if (botSession) {
      return {
        propertyId: botSession.property_id as string,
        userId: "",
        role: "subagent",
      };
    }
  }
  throw new Error(
    "An authenticated property member is required for this session.",
  );
}
