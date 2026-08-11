#!/usr/bin/env node
/**
 * An explicit "run this as a background job" must START THE JOB, not
 * interview the requester.
 *
 * Regression guard for 2026-08-11: the elicit-before-detach doctrine
 * (added the same day so jobs stop writing "TO CONFIRM" placeholders into
 * deliverables) over-fired. Asked verbatim to "run this as a background job",
 * the bot parked with three questions — and its own first option was "use
 * sensible defaults", which is the proof it never needed to ask. The
 * persona's default-test now governs: if you can state a sensible default,
 * take it and say what you assumed.
 *
 * Drives eve DIRECTLY (no Stream webhook), so it works against a local dev
 * runtime before a deploy as well as against prod.
 *
 *   node --env-file=.env.local --no-network-family-autoselection \
 *     scripts/job-dispatch-test.mjs
 *   TEST_ORIGIN=https://hotelclaw-app.vercel.app node ... (prod)
 */
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.env.TEST_ORIGIN ?? "http://127.0.0.1:3000";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHANNEL_ID =
  process.env.TEST_CHANNEL ?? "prop-697681e8-food-and-beverage-5d05af";

// The harness's own wording (scripts/bot-chat-test.mjs, parallel/job).
const ASK =
  "please run this as a background job: a comprehensive audit cross-referencing our SOP documents against tasks and guest complaints, full report.";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (n, x = "") => console.log(`  ✅ ${n}${x ? ` — ${x}` : ""}`);
const bad = (n, d) => {
  failures++;
  console.log(`  ❌ ${n}\n     ${d}`);
};

async function main() {
  const { data: ch } = await sb
    .from("chat_channels")
    .select("property_id")
    .eq("stream_channel_id", CHANNEL_ID)
    .single();
  const { data: member } = await sb
    .from("memberships")
    .select("user_id")
    .eq("property_id", ch.property_id)
    .in("role", ["owner", "manager"])
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  const since = new Date().toISOString();
  const nonce = crypto.randomUUID();
  console.log(`\nDispatching an explicit background-job request via ${ORIGIN}\n`);

  const res = await fetch(`${ORIGIN}/eve/v1/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SERVICE_KEY}`,
      "x-hotelclaw-property": ch.property_id,
      "x-hotelclaw-user": member.user_id,
      "x-hotelclaw-bot": "hotelclaw",
      "x-hotelclaw-channel": CHANNEL_ID,
      "x-hotelclaw-sender": member.user_id,
    },
    body: JSON.stringify({
      message: [
        `[turn ${nonce} — internal marker, ignore]`,
        `[Now: ${new Date().toISOString()} (UTC). Resolve relative dates/times from this.]`,
        `[Activation: you were @-mentioned in the newest message]`,
        `A teammate says: ${ASK}`,
      ].join("\n\n"),
    }),
  });
  if (!res.ok) throw new Error(`session create failed: ${res.status}`);
  const { sessionId } = await res.json();
  console.log(`session ${sessionId}\nwaiting up to 3 min for the dispatch decision…\n`);

  // start_background_job inserts a kind='job' row for this channel. That row
  // IS the assertion — it exists only if the tool actually ran.
  let job = null;
  for (let i = 0; i < 36; i++) {
    await sleep(5_000);
    const { data } = await sb
      .from("channel_bot_sessions")
      .select("id, job_headline, created_at, runtime_tag")
      .eq("channel_id", CHANNEL_ID)
      .eq("kind", "job")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      job = data;
      break;
    }
  }

  if (!job) {
    bad(
      "explicit request started a background job",
      "no kind='job' row — the bot interviewed instead of dispatching",
    );
  } else {
    ok("explicit request started a background job", `"${job.job_headline}"`);
    // The tag inheritance fix: without it, an answer to a parked job question
    // is refused as stale.
    if (job.runtime_tag) ok("job row inherited a runtime tag", job.runtime_tag.slice(0, 22));
    else bad("job row inherited a runtime tag", "runtime_tag is null");
    await sb.from("channel_bot_sessions").delete().eq("id", job.id);
    console.log("\n(job row cleaned up — the detached session finishes on its own)");
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nPASS\n" : `\nFAIL — ${failures} assertion(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(`\nERROR: ${e.message}\n`);
    process.exit(1);
  });
