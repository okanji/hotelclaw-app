import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { createServerClient } from "@supabase/ssr";
import { serviceClient } from "../lib/supabase";
import {
  accumulateUsage,
  activityLabel,
  firstSentence,
  recordActivity,
  recordStep,
  setLiveActivity,
  settleRequests,
  settleStep,
  deliverFailure,
  deliverReply,
  drainQueueOrIdle,
  findSessionRow,
  updateSessionRow,
  type StepKind,
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
  // Guests (0118) never reach the agent runtime: its tools act through the
  // service client across the whole property, past every grant. Every
  // authenticator funnels through here, so this one line is the gate.
  if (!data || data.role === "guest") return null;
  return data;
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

    // One trace row PER action (0113), labelled the way eve's reference
    // channel labels them (docs/channels/slack.mdx "Delivery"): the tool's
    // own `label.start` projection when eve supplies one in `presentation`
    // (built-ins: web_search, web_fetch, eve__skill, eve__search), else our
    // subject-aware TOOL_ACTIVITY map. The live status line shows the first
    // action plus "+N more", and never names the model's own task-control
    // calls (`eve__task_wait` / `eve__task_cancel`).
    "actions.requested": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const payload = data as unknown as {
        actions?: readonly Record<string, unknown>[];
        presentation?: Record<string, { label?: string } | undefined>;
      };
      const actions = payload.actions ?? [];
      const described = actions
        .map((a) => {
          const callId = typeof a.callId === "string" ? a.callId : null;
          const kind: StepKind | null =
            a.kind === "tool-call" || a.kind === "workflow-tool-call"
              ? "tool"
              : a.kind === "load-skill"
                ? "skill"
                : a.kind === "subagent-call" || a.kind === "remote-agent-call"
                  ? "subagent"
                  : null;
          const toolName =
            kind === "tool" && typeof a.toolName === "string"
              ? a.toolName
              : kind === "skill"
                ? "load_skill"
                : kind === "subagent"
                  ? "subagent"
                  : "";
          // Subagent kinds carry their human description at the top level,
          // not inside `input` — fold it in so the label can use it. Skill
          // loads carry the skill as `name`.
          const input =
            kind === "subagent" && typeof a.description === "string"
              ? { description: a.description, ...(a.input as object | null) }
              : kind === "skill" && typeof a.name === "string"
                ? { name: a.name, ...(a.input as object | null) }
                : a.input;
          const presented = callId ? payload.presentation?.[callId]?.label : undefined;
          return { kind, callId, toolName, input, presented: presented?.trim() || null };
        })
        .filter(
          (a): a is typeof a & { kind: StepKind } =>
            !!a.kind &&
            !!a.toolName &&
            a.toolName !== "eve__task_wait" &&
            a.toolName !== "eve__task_cancel",
        );
      if (described.length === 0) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce) return;

      const labels: string[] = [];
      for (const action of described) {
        const label =
          action.presented ??
          ((await activityLabel([action], row.property_id)) ?? action.toolName);
        labels.push(label);
        await recordStep(row, {
          kind: action.kind,
          label,
          callId: action.callId,
          toolName: action.toolName,
          input: action.input,
          status: "running",
          silent: true,
        });
      }
      const rest = labels.length - 1;
      await setLiveActivity(row, rest > 0 ? `${labels[0]} +${rest} more…` : labels[0]);
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

      const payload = data as unknown as {
        result?: {
          callId?: string;
          toolName?: string;
          name?: string;
          output?: unknown;
          isError?: boolean;
        };
        status?: "completed" | "failed" | "rejected";
        error?: { code?: string; message?: string };
        presentation?: Record<string, { label?: string } | undefined>;
      };
      const result = payload.result;
      const callId = typeof result?.callId === "string" ? result.callId : null;
      if (callId) {
        const status =
          payload.status === "failed" || result?.isError
            ? "failed"
            : payload.status === "rejected"
              ? "rejected"
              : "completed";
        // eve's `label.complete` projection, when the tool defines one.
        const completeLabel = payload.presentation?.[callId]?.label?.trim() || null;
        await settleStep(
          row,
          { callId },
          {
            status,
            output: result?.output,
            detail:
              status === "failed"
                ? payload.error?.message ?? firstSentence(result?.output) ?? "Failed"
                : status === "rejected"
                  ? "Not approved"
                  : firstSentence(result?.output),
            label: completeLabel,
          },
        );
        // slack.mdx: "A tool finishes → the tool's label.complete text, when
        // it defines one; otherwise the status stays." Our catalog tools
        // define none, and the model's next generation can run minutes, so
        // a neutral line replaces the finished tool's label rather than
        // blaming it for time it didn't spend.
        await setLiveActivity(row, completeLabel ?? "Working on it");
      } else {
        await setLiveActivity(row, "Working on it");
      }

      if (result?.toolName !== "render_ui") return;
      const spec = (result.output as { ai_ui_spec?: unknown } | undefined)?.ai_ui_spec;
      if (!spec) return;
      await updateSessionRow(row.id, { ui_spec: spec });
    },

    // Reasoning summary (Anthropic adaptive thinking, display "summarized" —
    // agent.ts). Kept as its own trace row so the chat can offer it as a
    // Reasoning disclosure; the live line shows the latest finished
    // sentence, per the reference channel's status table.
    "reasoning.completed": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const text =
        typeof (data as { reasoning?: unknown }).reasoning === "string"
          ? ((data as { reasoning: string }).reasoning).trim()
          : "";
      if (!text) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;
      const sentences = text.match(/[^.!?\n]+[.!?]?/g) ?? [text];
      const last = sentences[sentences.length - 1]?.trim() || "Thinking";
      await recordStep(row, {
        kind: "reasoning",
        label: last.length > 50 ? `${last.slice(0, 49)}…` : last,
        detail: text.slice(0, 6000),
        status: "completed",
      });
    },

    // Subagent / background task lifecycle (eve ≥ 0.69: every agent call is
    // a task). Rows mirror the reference channel's task card: the agent
    // name and the first sentence of its brief while working, then how it
    // ended.
    "task.started": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const task = data as unknown as {
        taskId?: string;
        callId?: string;
        name?: string;
        kind?: "agent" | "tool";
      };
      if (typeof task.taskId !== "string") return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;
      const name = task.name?.trim() || (task.kind === "agent" ? "Subagent" : "Task");
      await recordStep(row, {
        kind: "task",
        label: `${name}: working`,
        taskId: task.taskId,
        callId: task.callId ?? null,
        toolName: task.kind === "agent" ? "subagent" : "task",
        status: "running",
        silent: true,
      });
    },

    "task.settled": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const task = data as unknown as {
        taskId?: string;
        name?: string;
        status?: "completed" | "failed" | "cancelled";
        output?: unknown;
        error?: { message?: string };
        cancel?: { reason?: string };
      };
      if (typeof task.taskId !== "string") return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce) return;
      const name = task.name?.trim() || "Task";
      const detail =
        task.status === "failed"
          ? `Failed${task.error?.message ? `: ${firstSentence(task.error.message, 100)}` : ""}`
          : task.status === "cancelled"
            ? task.cancel?.reason === "task_cancel"
              ? "Stopped early since it was no longer needed"
              : task.cancel?.reason === "turn_cancelled"
                ? "Stopped by request"
                : task.cancel?.reason === "turn_ended"
                  ? "Stopped when the turn ended"
                  : "Stopped"
            : firstSentence(task.output, 100) ?? "Done";
      await settleStep(
        row,
        { taskId: task.taskId },
        {
          status: task.status ?? "completed",
          output: task.output,
          detail,
          label: `${name}: ${task.status === "completed" ? "done" : task.status ?? "done"}`,
        },
      );
      if (task.status === "completed") {
        await setLiveActivity(row, `Reviewing ${name}'s results…`);
      }
    },

    // Usage per model step → the turn's running total (shown as the
    // ai-elements Context meter on the delivered reply).
    "step.started": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const modelId = (data as { modelId?: unknown }).modelId;
      if (typeof modelId !== "string") return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce || row.turn_usage?.modelId === modelId) return;
      await accumulateUsage(row, null, modelId);
    },

    "step.completed": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const usage = (data as { usage?: unknown }).usage as
        | Parameters<typeof accumulateUsage>[1]
        | undefined;
      if (!usage) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce) return;
      await accumulateUsage(row, usage);
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
                style: typeof o.style === "string" ? o.style : null,
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
      // The park itself is a step of the turn — a trace row per request,
      // closed by input.resolved (settleRequests) with the outcome.
      for (const r of requests) {
        if (!r.requestId) continue;
        const isApproval = r.kind === "tool-approval" || r.display === "confirmation";
        await recordStep(row, {
          kind: isApproval ? "approval" : "question",
          label: isApproval
            ? `Waiting for approval: ${r.toolName}`
            : r.kind === "session-limit"
              ? "Waiting: session budget reached"
              : "Waiting for an answer",
          callId: `request:${r.requestId}`,
          toolName: isApproval ? r.toolName : null,
          input: isApproval ? r.input : null,
          detail: r.prompt,
          status: "running",
          silent: true,
        });
      }
    },

    // The person answered (or the question was withdrawn): retire the park
    // in place, the way the reference channel does — buttons gone, outcome
    // shown — instead of leaving a live-looking question in the history.
    "input.resolved": async (data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const raw = (data as unknown as { resolutions?: readonly Record<string, unknown>[] })
        .resolutions ?? [];
      const resolutions = raw.flatMap((r) => {
        if (typeof r.requestId !== "string" || typeof r.outcome !== "string") return [];
        const response = (r.response ?? null) as
          | { optionId?: string | null; text?: string | null }
          | null;
        return [{ requestId: r.requestId, outcome: r.outcome, response }];
      });
      if (resolutions.length === 0) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row) return;
      await settleRequests(row, resolutions);
    },

    // The turn was cancelled (eve /cancel, or Stop at the session-limit
    // prompt). session.waiting follows and delivers whatever accumulated.
    "turn.cancelled": async (_data, _channel, ctx) => {
      if (!channelBotSession(ctx as HandlerCtx)) return;
      const row = await findSessionRow((ctx as HandlerCtx).session.id, { retries: 0 });
      if (!row?.turn_nonce || row.delivered_nonce === row.turn_nonce) return;
      await recordStep(row, { kind: "thinking", label: "Stopped", status: "cancelled" });
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
      const sessionId = (ctx as HandlerCtx).session.id;
      if ((data as unknown as { on?: string }).on === "tasks") {
        // Not a settle point — the turn holds while its subagents work.
        // Status line per the reference channel: "Waiting on researcher…"
        // or "Waiting on 3 tasks…".
        const row = await findSessionRow(sessionId, { retries: 0 });
        if (!row?.turn_nonce) return;
        const { data: working } = await serviceClient()
          .from("channel_bot_activity")
          .select("label")
          .eq("channel_id", row.channel_id)
          .eq("thread_key", row.thread_key)
          .eq("turn_nonce", row.turn_nonce)
          .eq("kind", "task")
          .eq("status", "running");
        const names = (working ?? []).map((w) => String(w.label).replace(/: working$/, ""));
        await setLiveActivity(
          row,
          names.length === 1
            ? `Waiting on ${names[0]}…`
            : `Waiting on ${names.length || "its"} tasks…`,
        );
        return;
      }
      if ((data as unknown as { on?: string }).on !== "input") return;
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
