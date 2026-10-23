import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { createServerClient } from "@supabase/ssr";
import { serviceClient } from "../lib/supabase";
import {
  activityLabel,
  recordActivity,
  setLiveActivity,
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
// Which assistant project (assistant_projects) an Assistant-section session
// belongs to. Ownership + property are re-verified in agent-config.ts, so a
// bogus or borrowed id resolves to no project and the plain assistant persona
// applies — it can never widen scope.
const PROJECT_HEADER = "x-hotelclaw-project";
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
  projectId: string | null = null,
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
      ...(projectId ? { projectId } : {}),
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
      request.headers.get(PROJECT_HEADER),
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
      request.headers.get(PROJECT_HEADER),
    );
  };
}

// Mobile path: the Expo app has no cookies, so it sends its Supabase access
// token as `Authorization: Bearer <jwt>` (the same header lib/auth/api-caller
// accepts on the web API). Anything that isn't the service key is verified
// against the auth server with the anon client; a forged or expired token
// yields no user and falls through to the next authenticator (fail-closed).
function supabaseBearerAuth(): AuthFn<Request> {
  return async (request) => {
    const propertyId = request.headers.get(PROPERTY_HEADER);
    const auth = request.headers.get("authorization");
    if (!propertyId || !auth?.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (secret && (token === secret || token.startsWith(`${secret}:`))) return null;
    // Supabase access tokens are JWTs; skip anything that isn't shaped like one.
    if (token.split(".").length !== 3) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anonKey) return null;
    const supabase = createServerClient(url, anonKey, {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) return null;

    const membership = await verifyMembership(user.id, propertyId);
    if (!membership) return null;

    return principal(
      "supabase-bearer",
      user.id,
      propertyId,
      membership.role,
      request.headers.get(AGENT_HEADER),
      request.headers.get(BOT_HEADER),
      request.headers.get(CHANNEL_HEADER),
      user.id,
      request.headers.get(PROJECT_HEADER),
    );
  };
}

// localDev() stays last for bare local smoke tests (no property attributes →
// dynamic resolvers fall back to static instructions) — but ONLY off Vercel:
// in production the list is fail-closed (Supabase cookie or service bearer,
// both membership-checked).
const authChain: AuthFn[] = [supabaseCookieAuth(), serviceBearerAuth(), supabaseBearerAuth()];
if (!process.env.VERCEL) authChain.push(localDev());

// ---------------------------------------------------------------------------
// Event-driven chat delivery (default channel bot only).
//
// Per eve's channel doctrine, event handlers "deliver completed messages
// back to the surface that owns this channel" (docs/channels/custom) — the
// runtime posts the reply to Stream when the turn actually finishes,
// instead of the webhook function holding a connection open until the turn
// parks. Handlers run inside the durable step, so turn length is unbounded
// and parked work holds no compute.
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
//
// TWO delivery points since eve 0.70: a question or approval no longer ends
// the turn — the stream emits `input.requested` then `turn.waiting {on:
// "input"}` and the SAME turn resumes when the person answers, so the park
// is delivered from `turn.waiting`. A turn that ends normally still parks
// the session with `session.waiting`, the second delivery point.
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

/** Post the turn's accumulated reply exactly once per nonce. Shared by the
 * two park points (turn.waiting on input, session.waiting at turn end). */
async function deliverOnce(sessionId: string): Promise<void> {
  const row = await findSessionRow(sessionId);
  if (!row) return;
  await updateSessionRow(row.id, {
    turn_activity: null,
    last_turn_at: new Date().toISOString(),
  });
  if (row.turn_nonce && row.delivered_nonce !== row.turn_nonce) {
    await updateSessionRow(row.id, { delivered_nonce: row.turn_nonce });
    await deliverReply(row);
  }
}

export default eveChannel({
  auth: authChain,
  events: {
    // ── Progress line ────────────────────────────────────────────────────
    // turn_activity drives the chat's thinking row (0095). Written on the
    // events that already fire a handful of times per turn — NOT on
    // message.appended, which would cost a workflow step per token.
    "turn.started": async (_data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce) return;
      await recordActivity(row, "Thinking");
    },

    "actions.requested": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const actions = (data as unknown as { actions?: readonly Record<string, unknown>[] })
        .actions ?? [];
      // Every action kind carries `input`, which is where the progress label
      // gets its SUBJECT (which document, which skill, which query). eve's
      // control-plane kinds have no `toolName` — map them onto synthetic ones
      // so `load-skill` reads as the skill it is loading rather than nothing.
      const described = actions
        .map((a) => {
          const toolName =
            a.kind === "tool-call" && typeof a.toolName === "string"
              ? a.toolName
              : a.kind === "load-skill"
                ? "load_skill"
                : a.kind === "subagent-call" || a.kind === "remote-agent-call"
                  ? "subagent"
                  : "";
          // Subagent kinds carry their human description at the top level,
          // not inside `input` — fold it in so the label can use it.
          const input =
            toolName === "subagent" && typeof a.description === "string"
              ? { description: a.description, ...(a.input as object | null) }
              : a.input;
          return { toolName, input };
        })
        .filter((a) => a.toolName);
      if (described.length === 0) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce) return;
      const label = await activityLabel(described, row.property_id);
      if (!label) return;
      await recordActivity(row, label);
    },

    // EVERY completed assistant message of the turn is kept, in order.
    // This was last-wins until 2026-08-05, when "Tell me about our most
    // important SOPs. Also, what are SOPs?" produced two messages — the
    // definition + summary first, a short closing note second — and the
    // second silently overwrote the first. The user saw only the closing
    // note and reported the bot ignoring half the question; the model had
    // answered both, and delivery threw the answer away. A turn's messages
    // are a sequence, not a series of drafts. One retry covers the tiny
    // race between session creation and the web glue's row upsert.
    "message.completed": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const text = typeof data.message === "string" ? data.message.trim() : "";
      if (!text) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 1 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;
      const prior = (row.reply_candidate ?? "").trim();
      // A replayed or retried event must not duplicate its own message.
      if (prior === text || prior.endsWith(`\n\n${text}`)) return;
      await updateSessionRow(row.id, {
        reply_candidate: prior ? `${prior}\n\n${text}` : text,
      });
    },

    // Two jobs:
    //  1. render_ui returns the validated spec in its tool RESULT
    //     (ai_ui_spec) — capture it for the delivery post.
    //  2. Retire the progress label. The tool has FINISHED; what follows is
    //     the model generating, which can run for minutes (prod 2026-07-30:
    //     120s between a document read and the write, all of it generation).
    //     Leaving the tool's label up made that read as "Searching the
    //     property memory…" for two minutes — blaming memory for time it
    //     didn't spend. A neutral label is honest; the next actions.requested
    //     overwrites it with the real next step.
    "action.result": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;

      await setLiveActivity(row, "Working on it");

      const result = data.result as
        | { toolName?: string; output?: { ai_ui_spec?: unknown } }
        | undefined;
      if (result?.toolName !== "render_ui") return;
      const spec = result.output?.ai_ui_spec;
      if (!spec) return;
      await updateSessionRow(row.id, { ui_spec: spec });
    },

    // Input park — THREE request kinds share this event (eve's InputRequest
    // carries a `kind` discriminator since 0.28):
    //
    //   tool-approval → a gated tool awaiting a decision (display
    //     "confirmation"), routed to the fleet Approvals inbox, which reads
    //     `r.action` via parsePendingRequests.
    //   question      → the agent ASKING THE USER something (ask_question).
    //     The question is `prompt` — it never appears as message text, so the
    //     turn parks with an empty reply_candidate.
    //   session-limit → eve's own Continue/Stop budget prompt (0.82).
    //
    // All three are rendered by deliverReply from the stored requests; the
    // web glue answers them with `inputResponses` keyed by requestId.
    "input.requested": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const raw = (data as unknown as { requests?: readonly Record<string, unknown>[] })
        .requests ?? [];
      const requests = raw.map((r) => {
        const action = (r.action ?? {}) as Record<string, unknown>;
        const options = Array.isArray(r.options)
          ? (r.options as Array<Record<string, unknown>>)
              .map((o) => ({
                id: typeof o.id === "string" ? o.id : "",
                label: typeof o.label === "string" ? o.label : "",
                description:
                  typeof o.description === "string" ? o.description : null,
              }))
              .filter((o) => o.id && o.label)
          : [];
        return {
          // Shape the fleet Approvals inbox reads — do not rename.
          toolName: typeof action.toolName === "string" ? action.toolName : "unknown",
          input: action.input ?? null,
          callId: typeof action.callId === "string" ? action.callId : null,
          kind: typeof r.kind === "string" ? r.kind : null,
          // Question fields: what the user actually needs to see, and
          // what the answer must be addressed to on resume.
          prompt: typeof r.prompt === "string" ? r.prompt : null,
          requestId: typeof r.requestId === "string" ? r.requestId : null,
          display: typeof r.display === "string" ? r.display : null,
          allowFreeform: r.allowFreeform === true,
          options,
        };
      });
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

    // Non-terminal turn failure: session.waiting follows and the turn's
    // accumulator may be empty. Put the reason in the reply so the fail-loud
    // notice names the error instead of "completed without a reply".
    "turn.failed": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const failure = data as unknown as { code?: string; message?: string; terminal?: boolean };
      if (failure.terminal) return; // session.failed handles the terminal case
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;
      const prior = (row.reply_candidate ?? "").trim();
      const note = `⚠️ That turn failed (${failure.code ?? "unknown"}: ${(failure.message ?? "").slice(0, 300)}). Send the message again to retry.`;
      await updateSessionRow(row.id, {
        reply_candidate: prior ? `${prior}\n\n${note}` : note,
      });
    },

    // Park on HUMAN INPUT (eve ≥ 0.70): the turn stays open, so this — not
    // session.waiting — is where a question or approval reaches the channel.
    // Deliver what the turn produced so far plus the rendered request, then
    // release the turn slot: the answer arrives as a new webhook trigger and
    // is addressed to the parked request by the web glue. Queued messages
    // are deliberately NOT drained here — an unrelated message would steer
    // the held turn and withdraw the question (the next trigger's fallback
    // drain carries them into the next turn instead).
    "turn.waiting": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      if ((data as unknown as { on?: string }).on !== "input") return;
      const sessionId = (ctx as HandlerCtx).session.id;
      await deliverOnce(sessionId);
      const row = await findSessionRow(sessionId, { retries: 0 });
      if (row) await updateSessionRow(row.id, { turn_state: "idle" });
    },

    // Turn ended, session parked: the second delivery point. Post the reply
    // once per nonce, then either DRAIN queued messages into the next turn
    // (the eve-docs app-layer-queue pattern) or mark the turn slot idle.
    "session.waiting": async (_data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const sessionId = (ctx as HandlerCtx).session.id;
      await deliverOnce(sessionId);
      const row = await findSessionRow(sessionId, { retries: 0 });
      if (!row) return;
      await drainQueueOrIdle(row, sessionId);
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
      // Separate write from the turn_state reset on purpose: turn_activity is
      // cosmetic, turn_state releases the turn slot. Merging them would let a
      // failed activity write (e.g. 0095 not yet applied) leave the slot
      // claimed until the 10-minute stale-claim recovery.
      await updateSessionRow(row.id, { turn_state: "idle" });
      await updateSessionRow(row.id, { turn_activity: null });
    },
  },
});
