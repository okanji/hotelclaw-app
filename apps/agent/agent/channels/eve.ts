import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { createServerClient } from "@supabase/ssr";
import { serviceClient } from "../lib/supabase";
import {
  deliverFailure,
  deliverReply,
  drainQueueOrIdle,
  findSessionRow,
  updateSessionRow,
} from "../lib/channel-delivery";

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
// Stream channel id the channel-bot session serves — lets resolvers look up
// chatbot_channel_deployments. Deployment rows are re-verified against the
// caller's property in agent-config.ts; a bogus id resolves to no deployment.
const CHANNEL_HEADER = "x-hotelclaw-channel";
// The RAW message sender (channel-bot sessions only; may differ from
// x-hotelclaw-user when the sender isn't a member and the acting principal
// fell back to a property owner). NEVER used to grant anything — role-gated
// tools resolve the sender's own membership from it, so it can only
// RESTRICT relative to the verified acting principal.
const SENDER_HEADER = "x-hotelclaw-sender";

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
  channelId: string | null = null,
  senderId: string | null = null,
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
      ...(channelId ? { channelId } : {}),
      ...(senderId ? { senderId } : {}),
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
      request.headers.get(CHANNEL_HEADER),
      // Browser sessions ARE the sender.
      user.id,
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
      request.headers.get(CHANNEL_HEADER),
      request.headers.get(SENDER_HEADER) ?? userId,
    );
  };
}

// localDev() stays last for bare local smoke tests (no property attributes →
// dynamic resolvers fall back to static instructions) — but ONLY off Vercel:
// in production the list is fail-closed (Supabase cookie or service bearer,
// both membership-checked).
const authChain: AuthFn[] = [supabaseCookieAuth(), serviceBearerAuth()];
if (!process.env.VERCEL) authChain.push(localDev());

// ---------------------------------------------------------------------------
// Event-driven chat delivery (default channel bot only).
//
// Per eve's channel doctrine, event handlers "deliver completed messages
// back to the surface that owns this channel" (docs/channels/custom) — the
// runtime posts the reply to Stream when the turn actually finishes,
// instead of the webhook function holding a connection open until the turn
// parks. Handlers run "inside the ALS-scoped harness step"
// (callback-context.d.ts), i.e., in workflow compute — turn length is
// unbounded and parked work holds no compute.
//
// Scope guard: only sessions whose VERIFIED auth attributes mark them as
// default-channel-bot sessions (botSlug 'hotelclaw', a channelId, no
// stored-agent id). Agent-section chats, pod bots, and delegate sessions
// are untouched — their existing paths still own delivery.
//
// Accumulation is DURABLE on channel_bot_sessions (0092): steps can run on
// different instances, so nothing lives in module memory. The web glue
// stamps `turn_nonce` on the row when it queues a turn (ChannelEvents has
// no message.received hook, so the nonce can't be recovered here) — only
// nonce-open turns accumulate/deliver. Fleet approval-decision turns don't
// re-stamp the nonce, so their parks skip delivery here (their own web
// path posts outcomes); the delivered_nonce guard plus a deterministic
// Stream message id make delivery idempotent under handler replay.
// ---------------------------------------------------------------------------

const CHANNEL_BOT_SLUG = "hotelclaw";

type HandlerCtx = {
  session: {
    id: string;
    auth: { current?: { attributes?: Record<string, unknown> } | null };
  };
};

function channelBotSession(ctx: HandlerCtx): boolean {
  const attributes = ctx.session.auth.current?.attributes ?? {};
  return (
    attributes.botSlug === CHANNEL_BOT_SLUG &&
    typeof attributes.channelId === "string" &&
    typeof attributes.agentId !== "string"
  );
}

export default eveChannel({
  auth: authChain,
  events: {
    // Last completed assistant message of the turn wins — the same
    // semantics consumeTurnStream implemented web-side. One retry covers
    // the tiny race between session creation and the web glue's row upsert.
    "message.completed": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const text = typeof data.message === "string" ? data.message : null;
      if (!text?.trim()) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 1 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;
      await updateSessionRow(row.id, { reply_candidate: text });
    },

    // render_ui returns the validated spec in its tool RESULT (ai_ui_spec)
    // — capture it for the delivery post.
    "action.result": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const result = data.result as
        | { toolName?: string; output?: { ai_ui_spec?: unknown } }
        | undefined;
      if (result?.toolName !== "render_ui") return;
      const spec = result.output?.ai_ui_spec;
      if (!spec) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;
      await updateSessionRow(row.id, { ui_spec: spec });
    },

    // Approval park: stamp the payload so the fleet inbox (realtime on this
    // table) lights up exactly as before.
    "input.requested": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const requests = Array.isArray((data as { requests?: unknown[] }).requests)
        ? ((data as { requests: Array<Record<string, unknown>> }).requests).map((r) => {
            const action = (r.action ?? {}) as Record<string, unknown>;
            return {
              toolName: typeof action.toolName === "string" ? action.toolName : "unknown",
              input: action.input ?? null,
              callId: typeof action.callId === "string" ? action.callId : null,
            };
          })
        : [];
      if (requests.length === 0) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce) return;
      await updateSessionRow(row.id, {
        status: "awaiting_approval",
        pending_approval: {
          requests,
          requestedAt: new Date().toISOString(),
          channelId: row.channel_id,
        },
      });
    },

    // Turn parked: THE delivery point. Store the fresh continuation token
    // (docs: follow-ups must use "the current continuationToken from that
    // event"), post the reply once per nonce, then either DRAIN queued
    // messages into the next turn (with that same fresh token — the
    // eve-docs app-layer-queue pattern) or mark the turn slot idle.
    "session.waiting": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const sessionId = (ctx as HandlerCtx).session.id;
      const row = await findSessionRow(sessionId);
      if (!row) return;
      const token =
        typeof (data as { continuationToken?: unknown }).continuationToken === "string"
          ? (data as { continuationToken: string }).continuationToken
          : null;
      if (token) {
        await updateSessionRow(row.id, {
          eve_continuation_token: token,
          last_turn_at: new Date().toISOString(),
        });
      }
      if (row.turn_nonce && row.delivered_nonce !== row.turn_nonce) {
        await updateSessionRow(row.id, { delivered_nonce: row.turn_nonce });
        await deliverReply(row);
      }
      await drainQueueOrIdle(row, sessionId, token);
    },

    // Fail-loud contract: a dead session posts a visible ⚠️, never silence.
    // (session.failed handlers receive no ctx — resolve the row from the
    // sessionId in the event data.) The queue is left intact: the next
    // trigger's web-side fallback drain answers what queued up.
    "session.failed": async (data) => {
      const sessionId = (data as { sessionId?: unknown }).sessionId;
      if (typeof sessionId !== "string") return;
      const row = await findSessionRow(sessionId, { retries: 0 });
      if (!row) return;
      if (row.turn_nonce && row.delivered_nonce !== row.turn_nonce) {
        await updateSessionRow(row.id, { delivered_nonce: row.turn_nonce });
        await deliverFailure(
          row,
          `${(data as { code?: string }).code ?? "unknown"}: ${(data as { message?: string }).message ?? ""}`,
        );
      }
      await updateSessionRow(row.id, { turn_state: "idle" });
    },
  },
});
