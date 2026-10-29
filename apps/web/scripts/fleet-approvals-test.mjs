// Gated-tool probe: @bookings comp night → row flips awaiting_approval with a
// populated payload → resolve via the runPodDecisionTurn path (the Fleet
// approvals mechanism) → row clears, outcome lands in the channel.
import { createClient } from "@supabase/supabase-js";
import { StreamChat } from "stream-chat";
const ORIGIN = "http://127.0.0.1:3000";
const WATAMU = "c63d28a6-b8fb-452e-8eee-ebe1e0e4a4fa";
const OWNER = "33831554-d1a7-4f62-85a5-85952cbc11e4";
const CH = "prop-c63d28a6-podtest-approvals";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let failed = false;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failed = true;
};

// A fresh reference per run so the model treats it as a new request. The
// probe used to refund a seeded `bookings` row; the booking-table tools were
// removed with the Bookings feature (2026-10-29), so it now exercises the
// other approval-gated money tool, comp_night (task-only, no booking read).
// REQUIRES the `bookings` pod bot's tool allow-list to include comp_night
// (Fleet → Pod bots → Bookings, or re-run scripts/seed-pod1.mjs).
const probeRef = `BKG-PRB${Date.now().toString(36).slice(-4).toUpperCase()}`;

// Clean slate for the probe channel (create it in Stream first).
const stream = StreamChat.getInstance(process.env.NEXT_PUBLIC_STREAM_API_KEY, process.env.STREAM_API_SECRET, { timeout: 15000 });
await stream.upsertUser({ id: OWNER, name: "Oamar" });
const ch = stream.channel("team", CH, { created_by_id: OWNER, members: [OWNER] });
await ch.create().catch(() => {});
await ch.truncate().catch(() => {});
await supabase.from("bot_chat_sessions").delete().eq("channel_id", CH);

const trigger = (text) =>
  fetch(`${ORIGIN}/api/dev/pod-bot-test`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ propertyId: WATAMU, channelId: CH, senderId: OWNER, senderName: "Oamar", text }),
  }).then((r) => r.json());

const t = await trigger(`@bookings Please comp one night on stay ${probeRef} — the guest's room AC failed overnight.`);
check("comp request handled", t.handled === true);

// Wait for the turn to complete and the park to be stamped.
let row = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const { data } = await supabase
    .from("bot_chat_sessions")
    .select("id, status, pending_approval, eve_session_id")
    .eq("channel_id", CH)
    .maybeSingle();
  row = data;
  if (row?.status === "awaiting_approval") break;
}
check("row stamped awaiting_approval", row?.status === "awaiting_approval", JSON.stringify(row).slice(0, 200));
const requests = row?.pending_approval?.requests ?? [];
check(
  "pending payload has comp_night",
  requests.some((r) => r.toolName === "comp_night"),
  JSON.stringify(row?.pending_approval ?? null).slice(0, 200),
);

// Resolve through the SAME code the Fleet UI action uses
// (runPodDecisionTurn via the dev harness route).
if (row?.status === "awaiting_approval") {
  const res = await fetch(`${ORIGIN}/api/dev/fleet-decide`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ sessionRowId: row.id, decision: "deny", actorUserId: OWNER }),
  }).then((r) => r.json());
  check("UI decision path resolved", res.ok === true, JSON.stringify(res).slice(0, 200));
  const { data: cleared } = await supabase
    .from("bot_chat_sessions")
    .select("status, pending_approval")
    .eq("channel_id", CH)
    .maybeSingle();
  check("row cleared to idle after decision", cleared?.status === "idle" && cleared?.pending_approval === null, JSON.stringify(cleared));
  // The outcome must have landed in the Stream channel as the bot.
  const q = await ch.query({ messages: { limit: 10 } });
  const botMsgs = (q.messages ?? []).filter((m) => (m.user?.id ?? "").startsWith("pod-"));
  const last = botMsgs[botMsgs.length - 1];
  check("outcome posted to channel", Boolean(last), String(last?.text).slice(0, 120));
  if (last) console.log(`   ↳ ${String(last.text).slice(0, 140)}`);
}

console.log(failed ? "\nGATED PROBE FAILED" : "\nGated-tool probe passed.");
process.exit(failed ? 1 : 0);
