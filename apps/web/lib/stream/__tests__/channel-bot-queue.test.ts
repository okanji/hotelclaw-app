import { describe, it, expect, afterAll } from "vitest";

/**
 * Integration tests for the lossless-conversation primitives (migration
 * 0093): the atomic Postgres turn CLAIM, the mid-turn message queue, and
 * stale-claim recovery. These run against the real (dev) Supabase — the
 * same statements production executes — and skip cleanly when the env
 * isn't present (plain `pnpm test` in CI):
 *
 *   node --env-file=.env.local node_modules/.bin/vitest run lib/stream
 */
const hasEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHANNEL = `test-claim-${crypto.randomUUID().slice(0, 8)}`;
const THREAD = "_root";
// Any real property id satisfies the FK; Solana Cove demo property.
const PROPERTY = "d58fc73b-9077-404d-9f2b-6eb56902d91a";

describe.skipIf(!hasEnv)("channel turn claim + queue (0093)", () => {
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
    expect(typeof mod.claimChannelTurn).toBe("function");
  });

  it("first claim on a fresh channel wins (insert path)", async () => {
    const claimed = await mod.claimChannelTurn({
      propertyId: PROPERTY,
      channelId: CHANNEL,
      channelType: "team",
      threadKey: THREAD,
    });
    expect(claimed).toBe(true);
    const { data } = await sb
      .from("channel_bot_sessions")
      .select("turn_state, turn_started_at, kind")
      .eq("channel_id", CHANNEL)
      .eq("thread_key", THREAD)
      .single();
    expect(data.turn_state).toBe("running");
    expect(data.kind).toBe("chat");
    expect(data.turn_started_at).toBeTruthy();
  });

  it("second claim while running loses — the message must queue", async () => {
    const claimed = await mod.claimChannelTurn({
      propertyId: PROPERTY,
      channelId: CHANNEL,
      channelType: "team",
      threadKey: THREAD,
    });
    expect(claimed).toBe(false);
  });

  it("enqueue parks the losing message durably", async () => {
    await mod.enqueueChannelMessage({
      propertyId: PROPERTY,
      channelId: CHANNEL,
      threadKey: THREAD,
      message: {
        messageId: "m-1",
        text: "queued while busy",
        userId: "user-1",
        userName: "Queue Tester",
        activationReason: "mention",
      },
    });
    const { data } = await sb
      .from("channel_bot_queue")
      .select("message")
      .eq("channel_id", CHANNEL);
    expect(data).toHaveLength(1);
    expect(data[0].message.text).toBe("queued while busy");
  });

  it("release unwedges the slot; the next claim wins (update path)", async () => {
    await mod.releaseChannelTurn(CHANNEL, THREAD);
    const { data: after } = await sb
      .from("channel_bot_sessions")
      .select("turn_state")
      .eq("channel_id", CHANNEL)
      .eq("thread_key", THREAD)
      .single();
    expect(after.turn_state).toBe("idle");

    const claimed = await mod.claimChannelTurn({
      propertyId: PROPERTY,
      channelId: CHANNEL,
      channelType: "team",
      threadKey: THREAD,
    });
    expect(claimed).toBe(true);
  });

  it("a stale running claim (crashed turn) is reclaimable", async () => {
    // Simulate a turn that died 11 minutes ago without parking.
    await sb
      .from("channel_bot_sessions")
      .update({
        turn_state: "running",
        turn_started_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      })
      .eq("channel_id", CHANNEL)
      .eq("thread_key", THREAD);

    const claimed = await mod.claimChannelTurn({
      propertyId: PROPERTY,
      channelId: CHANNEL,
      channelType: "team",
      threadKey: THREAD,
    });
    expect(claimed).toBe(true);
  });

  it("a FRESH running claim is NOT reclaimable", async () => {
    // The previous test left it running with a fresh timestamp.
    const claimed = await mod.claimChannelTurn({
      propertyId: PROPERTY,
      channelId: CHANNEL,
      channelType: "team",
      threadKey: THREAD,
    });
    expect(claimed).toBe(false);
  });

  it("job rows never participate in the chat claim", async () => {
    await sb.from("channel_bot_sessions").insert({
      property_id: PROPERTY,
      channel_id: CHANNEL,
      thread_key: "job:test",
      kind: "job",
      turn_state: "idle",
    });
    // The chat slot is still running-fresh → claim must fail even though a
    // kind='job' row for the channel sits idle.
    const claimed = await mod.claimChannelTurn({
      propertyId: PROPERTY,
      channelId: CHANNEL,
      channelType: "team",
      threadKey: THREAD,
    });
    expect(claimed).toBe(false);
  });

  afterAll(async () => {
    if (!sb) return;
    await sb.from("channel_bot_sessions").delete().eq("channel_id", CHANNEL);
    await sb.from("channel_bot_queue").delete().eq("channel_id", CHANNEL);
  });
});
