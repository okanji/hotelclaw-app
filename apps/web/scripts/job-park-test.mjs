#!/usr/bin/env node
/**
 * Background jobs that PARK AND ASK — end-to-end (migration 0098).
 *
 * Until 2026-08-11 a background job's brief told it "nobody can answer
 * follow-up questions", so a job that hit an unknown wrote a placeholder into
 * the deliverable instead of asking (three "TO CONFIRM" blocks landed in a
 * real walk-in-freezer SOP). Jobs can ask now. The route back is the Stream
 * thread under the question: `channel_bot_sessions.question_message_id`.
 *
 * What this proves, against the real runtime and real Stream:
 *   1. A job that needs a fact calls ask_question instead of guessing.
 *   2. The park is DELIVERED to the channel as a question — headlined
 *      "⏸️ … I need one thing from you", not "✅ … finished".
 *   3. The turn slot is released and `question_message_id` anchors the
 *      question to the posted message.
 *   4. Answering in that thread resumes THAT job session (the webhook gate,
 *      via /api/dev/parked-answer — the same function the webhook calls).
 *   5. The job finishes and posts its result, and the result contains the
 *      answer we gave it and NO placeholder text.
 *
 * Runs against DEV or PROD, and never touches the shared Stream webhook:
 *
 *   # dev — needs `pnpm dev` on :3000 (Node 24). The webhook points at prod,
 *   # so the inbound half is driven through /api/dev/parked-answer.
 *   node --env-file=.env.local --no-network-family-autoselection \
 *     scripts/job-park-test.mjs [--channel <id>]
 *
 *   # prod — the real webhook already points here, so the thread reply
 *   # exercises the genuine inbound path end to end.
 *   TEST_ORIGIN=https://hotelclaw-app.vercel.app node --env-file=.env.local \
 *     --no-network-family-autoselection scripts/job-park-test.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { StreamChat } from "stream-chat";

const ORIGIN = process.env.TEST_ORIGIN ?? "http://127.0.0.1:3000";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_USER_ID = process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai";

const argv = process.argv.slice(2);
const channelArg = argv.indexOf("--channel");
const CHANNEL_ID =
  channelArg >= 0 ? argv[channelArg + 1] : "prop-697681e8-food-and-beverage-5d05af";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE_KEY);
const stream = StreamChat.getInstance(
  process.env.NEXT_PUBLIC_STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
  { timeout: 20_000 },
);

let failures = 0;
const ok = (name, extra = "") => console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ""}`);
const bad = (name, detail) => {
  failures++;
  console.log(`  ❌ ${name}\n     ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until `check` returns truthy, or give up. */
async function until(label, ms, check) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await sleep(3_000);
  }
  throw new Error(`timed out waiting for ${label} after ${Math.round(ms / 1000)}s`);
}

const jobRow = (id) =>
  sb
    .from("channel_bot_sessions")
    .select(
      "id, kind, job_headline, turn_state, pending_approval, question_message_id, eve_session_id, turn_nonce",
    )
    .eq("id", id)
    .maybeSingle()
    .then(({ data }) => data);

async function main() {
  console.log(`\nBackground-job park & ask — channel ${CHANNEL_ID}\n`);

  // Property + a real member to act as. The job runs as a normal channel-bot
  // session, so it needs the same principal the webhook would supply.
  // (Resolve via chat_channels — the channel id's `prop-<8 hex>` prefix is a
  // truncation, and `ilike` doesn't apply to a uuid column.)
  const { data: chatChannel } = await sb
    .from("chat_channels")
    .select("property_id")
    .eq("stream_channel_id", CHANNEL_ID)
    .maybeSingle();
  if (!chatChannel) throw new Error(`no chat_channels row for ${CHANNEL_ID}`);
  const { data: property } = await sb
    .from("properties")
    .select("id, name")
    .eq("id", chatChannel.property_id)
    .maybeSingle();
  if (!property) throw new Error(`no property for ${CHANNEL_ID}`);
  const { data: member } = await sb
    .from("memberships")
    .select("user_id")
    .eq("property_id", property.id)
    .in("role", ["owner", "manager"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) throw new Error("no owner/manager to act as");
  console.log(`property: ${property.name}\nacting as: ${member.user_id}\n`);

  const before = new Date().toISOString();

  // ── 1. Start a job whose brief CANNOT be completed without one fact ────
  // The brief deliberately withholds it, so a correct job must ask.
  const headline = `PARKTEST ${new Date().toISOString().slice(11, 19)}`;
  const brief = [
    "Write a two-line internal note titled 'Freezer callout card'.",
    "It must state the refrigeration contractor's emergency call-out phone number.",
    "That number is NOT in any document, task, or brain page — it is not recorded anywhere you can reach.",
    "Do NOT search for longer than one tool call. Do NOT invent a number.",
    "Ask the requester for the number, then put THEIR number in your final answer.",
    "Your final answer must be the two-line note, containing the number verbatim.",
  ].join(" ");

  console.log("1. starting the job…");
  const jobHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${SERVICE_KEY}`,
    "x-hotelclaw-property": property.id,
    "x-hotelclaw-user": member.user_id,
    "x-hotelclaw-bot": "hotelclaw",
    "x-hotelclaw-channel": CHANNEL_ID,
    "x-hotelclaw-sender": member.user_id,
  };
  const nonce = crypto.randomUUID();
  const created = await fetch(`${ORIGIN}/eve/v1/session`, {
    method: "POST",
    headers: jobHeaders,
    body: JSON.stringify({
      message: [
        `[turn ${nonce} — internal marker, ignore]`,
        `[Background job — you are running DETACHED in your own session. Work autonomously; never call start_background_job. Deliver ONE final answer — it will be posted to the team channel under the headline "${headline}".]`,
        `[You CAN ask the requester a question: call ask_question and you will park until they answer. NEVER write a placeholder into a deliverable — no "TO CONFIRM", no "TBD", no bracketed blanks.]`,
        brief,
      ].join("\n\n"),
    }),
  });
  if (!created.ok) throw new Error(`session create failed: ${created.status}`);
  const { sessionId } = await created.json();

  const { data: row, error: rowErr } = await sb
    .from("channel_bot_sessions")
    .insert({
      property_id: property.id,
      channel_id: CHANNEL_ID,
      channel_type: "team",
      thread_key: `job:${crypto.randomUUID()}`,
      kind: "job",
      job_headline: headline,
      eve_session_id: sessionId,
      turn_nonce: nonce,
      turn_state: "running",
      turn_started_at: new Date().toISOString(),
      last_turn_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (rowErr) throw new Error(`job row insert failed: ${rowErr.message}`);
  console.log(`   session ${sessionId}\n`);

  // ── 2. It must PARK ON A QUESTION rather than inventing a number ───────
  console.log("2. waiting for the job to park on a question (up to 4 min)…");
  const parked = await until("the job to park", 240_000, async () => {
    const r = await jobRow(row.id);
    return r?.question_message_id ? r : null;
  });
  ok("job parked on a question instead of guessing");
  ok("turn slot released", `turn_state=${parked.turn_state}`);
  if (parked.turn_state !== "idle") {
    bad("turn slot released", `expected idle, got ${parked.turn_state}`);
  }

  const prompts = (parked.pending_approval?.requests ?? [])
    .map((r) => r.prompt)
    .filter(Boolean);
  if (prompts.length === 0) bad("park carries a prompt", "no prompt on the park");
  else ok("park carries the question", JSON.stringify(prompts[0]).slice(0, 90));

  // ── 3. The question reached the CHANNEL, framed as a question ──────────
  const channel = stream.channel("team", CHANNEL_ID);
  const state = await channel.query({ messages: { limit: 40 } });
  const questionMsg = (state.messages ?? []).find(
    (m) => m.id === parked.question_message_id,
  );
  if (!questionMsg) {
    bad("question posted to the channel", `no message ${parked.question_message_id}`);
  } else {
    ok("question posted to the channel", `id ${questionMsg.id}`);
    if (questionMsg.text.includes("✅") || /finished/i.test(questionMsg.text)) {
      bad("parked job is not labelled finished", questionMsg.text.slice(0, 120));
    } else ok("labelled as paused, not finished");
    if (!/reply in this thread/i.test(questionMsg.text)) {
      bad("tells the reader how to answer", questionMsg.text.slice(0, 160));
    } else ok("tells the reader to reply in the thread");
  }

  // ── 4. Answer IN THE THREAD — the webhook's gate must route it home ────
  const ANSWER = "0117 555 8842 — that's Coldline Refrigeration's 24h line.";
  console.log("\n3. answering in the question's thread…");
  const reply = await channel.sendMessage({
    text: ANSWER,
    user_id: member.user_id,
    parent_id: parked.question_message_id,
    show_in_channel: false,
  });

  // Two ways the answer reaches the gate, and the SAME function runs either
  // way (routeAnswerToParkedSession):
  //   • against prod — the real Stream webhook already fired on the reply we
  //     just posted, so there is nothing to call. The dev route is disabled
  //     in production and 404s; that is the signal to sit back and poll.
  //   • against dev — the shared webhook points at prod, so the reply never
  //     reaches this machine. /api/dev/parked-answer stands in for it.
  const gate = await fetch(`${ORIGIN}/api/dev/parked-answer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      propertyId: property.id,
      channelId: CHANNEL_ID,
      channelType: "team",
      parentId: parked.question_message_id,
      text: ANSWER,
      userId: member.user_id,
      userName: "Test Operator",
      messageId: reply.message.id,
    }),
  }).catch(() => null);

  if (gate?.status === 404) {
    ok("routing left to the LIVE Stream webhook", "dev route disabled (production)");
  } else if (!gate?.ok) {
    bad("answer delivered to the gate", `dev route returned ${gate?.status ?? "unreachable"}`);
  } else {
    const gateBody = await gate.json();
    if (gateBody?.route?.kind !== "job") {
      bad("thread reply routed to the JOB session", JSON.stringify(gateBody));
    } else ok("thread reply routed to the job session");
  }

  // Assert the resume from the ROW either way — the webhook path is async, so
  // this must poll rather than read once.
  const resumed = await until("the job to resume", 90_000, async () => {
    const r = await jobRow(row.id);
    return r && r.question_message_id === null && r.turn_nonce !== parked.turn_nonce
      ? r
      : null;
  });
  ok("anchor cleared on resume");
  ok("fresh turn nonce stamped", resumed.turn_nonce.slice(0, 8));

  // ── 5. It finishes, using OUR number, with no placeholder ──────────────
  console.log("\n4. waiting for the job to finish (up to 4 min)…");
  await until("the job to finish", 240_000, async () => {
    const r = await jobRow(row.id);
    return r?.turn_state === "idle" && !r.question_message_id && r.turn_nonce !== parked.turn_nonce
      ? await (async () => {
          const s = await channel.query({ messages: { limit: 40 } });
          return (s.messages ?? []).find(
            (m) =>
              m.user?.id === BOT_USER_ID &&
              m.created_at > before &&
              (m.text ?? "").includes(headline) &&
              m.id !== parked.question_message_id,
          );
        })()
      : null;
  }).then((result) => {
    ok("job posted its result");
    const text = result.text ?? "";
    if (/555\s?8842/.test(text.replace(/‑|–|—/g, "-"))) {
      ok("result uses the number WE supplied");
    } else {
      bad("result uses the number we supplied", text.slice(0, 300));
    }
    if (/TO CONFIRM|\bTBD\b|\[\s*(insert|blank|xxx)/i.test(text)) {
      bad("no placeholder in the deliverable", text.slice(0, 300));
    } else ok("no placeholder in the deliverable");
    console.log(`\n--- result ---\n${text.slice(0, 600)}\n`);
  });

  // Cleanup: the job row only. Stream messages stay — they're the evidence.
  await sb.from("channel_bot_sessions").delete().eq("id", row.id);
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nPASS\n" : `\nFAIL — ${failures} assertion(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(`\nERROR: ${err.message}\n`);
    process.exit(1);
  });
