// Pod-bot chat glue harness (fleet spec M3 acceptance). Exercises the real
// webhook code path via /api/dev/pod-bot-test against the running dev
// server: addressing → session create → context packing → eve turn →
// Stream reply → continuation persistence, plus session independence
// across channels. Creates its own test channels; safe to re-run.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/pod-bot-chat-test.mjs

import { StreamChat } from "stream-chat";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.env.DEV_ORIGIN ?? "http://127.0.0.1:3000";
const KAYA = "c63d28a6-b8fb-452e-8eee-ebe1e0e4a4fa";
const OWNER = "33831554-d1a7-4f62-85a5-85952cbc11e4";
const CH_A = `prop-${KAYA.slice(0, 8)}-podtest-a`;
const CH_B = `prop-${KAYA.slice(0, 8)}-podtest-b`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const stream = StreamChat.getInstance(
  process.env.NEXT_PUBLIC_STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
  { timeout: 15000 },
);

let failed = false;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failed = true;
}

async function trigger(channelId, text) {
  const res = await fetch(`${ORIGIN}/api/dev/pod-bot-test`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      propertyId: KAYA,
      channelId,
      senderId: OWNER,
      senderName: "Oamar",
      text,
    }),
  });
  return res.json();
}

async function waitForBotReply(channel, afterCount, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const q = await channel.query({ messages: { limit: 30 } });
    const botMsgs = (q.messages ?? []).filter((m) =>
      (m.user?.id ?? "").startsWith("pod-"),
    );
    if (botMsgs.length > afterCount) return botMsgs[botMsgs.length - 1];
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

async function main() {
  // Setup: two fresh test channels.
  await stream.upsertUser({ id: OWNER, name: "Oamar" });
  for (const id of [CH_A, CH_B]) {
    const ch = stream.channel("team", id, {
      created_by_id: OWNER,
      members: [OWNER],
    });
    await ch.create().catch(() => {});
    await ch.truncate().catch(() => {});
  }
  await supabase
    .from("bot_chat_sessions")
    .delete()
    .in("channel_id", [CH_A, CH_B]);

  const chA = stream.channel("team", CH_A);
  const chB = stream.channel("team", CH_B);

  // Non-addressed messages are not handled.
  const miss = await trigger(CH_A, "how many bookings do we have?");
  check("non-addressed message not handled", miss.handled === false);
  const missBot = await trigger(CH_A, "@notabot are you there?");
  check("unknown bot slug not handled", missBot.handled === false);

  // Turn 1 in channel A — establishes remembered context for turn 2.
  const t1 = await trigger(
    CH_A,
    // An innocuous operational fact — an earlier probe used a "codeword",
    // which the hardened persona rightly refuses to store (it reads as
    // credential handling), failing the test for the wrong reason.
    "@frontdesk FYI for tonight: the maintenance contractor's van is parked by the MANGROVE gate. Confirm you noted it.",
  );
  check("addressed message handled", t1.handled === true);
  const r1 = await waitForBotReply(chA, 0);
  check("turn 1 reply posted", Boolean(r1), "no pod-frontdesk message");
  if (r1) console.log(`   ↳ ${String(r1.text).slice(0, 120)}`);

  const { data: s1 } = await supabase
    .from("bot_chat_sessions")
    .select("eve_session_id, eve_continuation_token")
    .eq("channel_id", CH_A)
    .maybeSingle();
  check(
    "session row persisted with continuation",
    Boolean(s1?.eve_session_id && s1?.eve_continuation_token),
  );

  // Turn 2 in channel A — durable memory across turns.
  await trigger(CH_A, "@frontdesk where did I say the contractor's van is parked?");
  const r2 = await waitForBotReply(chA, 1);
  check("turn 2 reply posted", Boolean(r2));
  check(
    "session remembers turn-1 fact (MANGROVE)",
    Boolean(r2 && /mangrove/i.test(String(r2.text))),
    `got: ${String(r2?.text).slice(0, 160)}`,
  );

  // Channel B with the same bot — independent session, no bleed.
  await trigger(CH_B, "@frontdesk where is the contractor's van parked? If nobody told you in THIS conversation, say NONE.");
  const rB = await waitForBotReply(chB, 0);
  check("channel B reply posted", Boolean(rB));
  check(
    "no session bleed across channels",
    Boolean(rB && !/mangrove/i.test(String(rB.text))),
    `got: ${String(rB?.text).slice(0, 160)}`,
  );
  const { data: sB } = await supabase
    .from("bot_chat_sessions")
    .select("eve_session_id")
    .eq("channel_id", CH_B)
    .maybeSingle();
  check(
    "distinct eve sessions per channel",
    Boolean(sB?.eve_session_id && sB.eve_session_id !== s1?.eve_session_id),
  );

  console.log(failed ? "\nPOD BOT CHAT TEST FAILED" : "\nPod bot chat test passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
