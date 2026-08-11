import { describe, it, expect, afterAll } from "vitest";

/**
 * Routing an ANSWER back to a session parked on a question (migration 0098).
 *
 * This is the gate the Stream webhook runs before its `ai_mode` dispatch. It
 * matters because `mention` is the DEFAULT mode: before this existed, a bot
 * that asked "which unit is the backup freezer?" never heard the reply unless
 * the user happened to @-mention it, and the session stayed parked forever.
 * Background jobs were worse — their `job:<uuid>` thread key is synthetic, so
 * no inbound message could reach them at all, and a job that hit an unknown
 * wrote a "TO CONFIRM" placeholder into the deliverable instead of asking.
 *
 * Runs against the real (dev) Supabase — the same statements production
 * executes — and skips cleanly without env (plain `pnpm test` in CI):
 *
 *   node --env-file=.env.local node_modules/.bin/vitest run lib/stream
 */
const hasEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHANNEL = `test-park-${crypto.randomUUID().slice(0, 8)}`;
// Any real property id satisfies the FK; Solana Cove demo property.
const PROPERTY = "d58fc73b-9077-404d-9f2b-6eb56902d91a";
const QUESTION_MSG = `msg-${crypto.randomUUID().slice(0, 8)}`;

const park = (prompt: string) => ({
  requests: [
    {
      toolName: "ask_question",
      requestId: `req-${crypto.randomUUID().slice(0, 8)}`,
      prompt,
      display: "text",
      allowFreeform: true,
      options: [],
    },
  ],
});

describe.skipIf(!hasEnv)("parked-question answer routing (0098)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let mod: any;
  let sb: any;

  it("imports the web glue outside Next (server-only stubbed)", async () => {
    mod = await import("@/lib/stream/channel-bot-eve");
    const { createClient } = await import("@supabase/supabase-js");
    sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    expect(typeof mod.routeAnswerToParkedSession).toBe("function");
  });

  it("hasPendingQuestion distinguishes a QUESTION from a bare approval", () => {
    expect(mod.hasPendingQuestion(park("Which unit?"))).toBe(true);
    // An approval park carries a prompt too — both are answerable, and both
    // were unreachable under mention mode before this gate.
    expect(mod.hasPendingQuestion({ requests: [{ prompt: "Approve?" }] })).toBe(true);
    // No prompt = an internal request with nothing for a human to answer.
    expect(mod.hasPendingQuestion({ requests: [{ toolName: "x" }] })).toBe(false);
    expect(mod.hasPendingQuestion(null)).toBe(false);
    expect(mod.hasPendingQuestion({})).toBe(false);
  });

  it("an idle conversation routes nothing", async () => {
    await sb.from("channel_bot_sessions").insert({
      property_id: PROPERTY,
      channel_id: CHANNEL,
      channel_type: "team",
      thread_key: "_root",
      kind: "chat",
      turn_state: "idle",
    });
    const route = await mod.routeAnswerToParkedSession({
      propertyId: PROPERTY,
      streamChannelId: CHANNEL,
      channelType: "team",
      parentId: null,
      triggerMessage: { id: "m1", text: "unrelated chatter", userId: "u1" },
    });
    expect(route).toBeNull();
  });

  it("a parked CONVERSATION claims the next channel message", async () => {
    await sb
      .from("channel_bot_sessions")
      .update({ pending_approval: park("Which unit is the backup freezer?") })
      .eq("channel_id", CHANNEL)
      .eq("thread_key", "_root");

    const route = await mod.routeAnswerToParkedSession({
      propertyId: PROPERTY,
      streamChannelId: CHANNEL,
      channelType: "team",
      parentId: null,
      triggerMessage: { id: "m2", text: "Unit 3", userId: "u1" },
    });
    // The caller must then run the normal turn for this thread REGARDLESS of
    // the channel's ai_mode — that is the whole point of the gate.
    expect(route).toEqual({ kind: "chat", parentId: null });
  });

  it("a reply in the QUESTION's thread reaches the parked conversation", async () => {
    // Answering in-thread would otherwise open a brand-new thread session and
    // strand the parked one; the anchor sends it home, and `parentId` comes
    // back as the thread the session actually lives in (root here).
    await sb
      .from("channel_bot_sessions")
      .update({ question_message_id: QUESTION_MSG })
      .eq("channel_id", CHANNEL)
      .eq("thread_key", "_root");

    const route = await mod.routeAnswerToParkedSession({
      propertyId: PROPERTY,
      streamChannelId: CHANNEL,
      channelType: "team",
      parentId: QUESTION_MSG,
      triggerMessage: { id: "m3", text: "Unit 3", userId: "u1" },
    });
    expect(route).toEqual({ kind: "chat", parentId: null });
  });

  it("a job whose session is unresumable clears its park instead of hanging", async () => {
    const jobThread = `job:${crypto.randomUUID()}`;
    const jobAnchor = `msg-job-${crypto.randomUUID().slice(0, 8)}`;
    await sb.from("channel_bot_sessions").insert({
      property_id: PROPERTY,
      channel_id: CHANNEL,
      channel_type: "team",
      thread_key: jobThread,
      kind: "job",
      job_headline: "Unresumable job",
      turn_state: "idle",
      // Deliberately no eve_session_id/token: the "job died with the build"
      // case. It must be reported, not silently swallowed.
      runtime_tag: "some-older-build",
      question_message_id: jobAnchor,
      pending_approval: park("What's the call-out number?"),
    });

    const route = await mod.routeAnswerToParkedSession({
      propertyId: PROPERTY,
      streamChannelId: CHANNEL,
      channelType: "team",
      parentId: jobAnchor,
      triggerMessage: { id: "m4", text: "0117 555 8842", userId: "u1" },
    });
    expect(route).toEqual({ kind: "job" });

    const { data } = await sb
      .from("channel_bot_sessions")
      .select("question_message_id, pending_approval, turn_state")
      .eq("channel_id", CHANNEL)
      .eq("thread_key", jobThread)
      .single();
    // Anchor and park cleared so the dead job stops capturing replies.
    expect(data.question_message_id).toBeNull();
    expect(data.pending_approval).toBeNull();
    expect(data.turn_state).toBe("idle");
  });

  it("the JOB anchor outranks the thread-key lookup", async () => {
    // Both a chat row (thread_key = the anchor id) and a job row anchored to
    // the same message could match. The anchor must win, or an answer meant
    // for a job would be delivered to a conversation instead.
    const shared = `msg-shared-${crypto.randomUUID().slice(0, 8)}`;
    await sb.from("channel_bot_sessions").insert([
      {
        property_id: PROPERTY,
        channel_id: CHANNEL,
        channel_type: "team",
        thread_key: shared,
        kind: "chat",
        turn_state: "idle",
        pending_approval: park("conversation question"),
      },
      {
        property_id: PROPERTY,
        channel_id: CHANNEL,
        channel_type: "team",
        thread_key: `job:${crypto.randomUUID()}`,
        kind: "job",
        job_headline: "Anchored job",
        turn_state: "idle",
        runtime_tag: "some-older-build",
        question_message_id: shared,
        pending_approval: park("job question"),
      },
    ]);

    const route = await mod.routeAnswerToParkedSession({
      propertyId: PROPERTY,
      streamChannelId: CHANNEL,
      channelType: "team",
      parentId: shared,
      triggerMessage: { id: "m5", text: "answer", userId: "u1" },
    });
    expect(route).toEqual({ kind: "job" });
  });

  afterAll(async () => {
    if (!sb) return;
    await sb.from("channel_bot_sessions").delete().eq("channel_id", CHANNEL);
  });
});
