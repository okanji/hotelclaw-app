#!/usr/bin/env node
/**
 * A parked CONVERSATION question survives `mention` mode — the live bug.
 *
 * `mention` is the DEFAULT ai_mode, and the webhook's mode gate ran BEFORE
 * anything checked for a parked session:
 *
 *     if (mode === "mention" && !args.botMentioned) return;   // route.ts
 *
 * So the bot could ask "which unit is the backup freezer?", the user could
 * answer in plain words, and the message was dropped on the floor — the
 * session stayed parked forever. The same hole applied to every
 * approval-gated tool (archive_document, delete_task, …), which had no
 * decision path at all from chat.
 *
 * This drives the real thing: mention mode, a question the bot must ask
 * because the fact exists nowhere, then an answer with NO @-mention.
 *
 *   TEST_ORIGIN=https://hotelclaw-app.vercel.app node --env-file=.env.local \
 *     --no-network-family-autoselection scripts/parked-chat-test.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { StreamChat } from "stream-chat";

const CHANNEL_ID =
  process.env.TEST_CHANNEL ?? "prop-697681e8-food-and-beverage-5d05af";
const BOT_USER_ID = process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai";
const TESTER = "bot-tester";
const NUMBER = "0117 555 9911";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const stream = StreamChat.getInstance(
  process.env.NEXT_PUBLIC_STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
  { timeout: 20_000 },
);

let failures = 0;
const ok = (n, x = "") => console.log(`  ✅ ${n}${x ? ` — ${x}` : ""}`);
const bad = (n, d) => {
  failures++;
  console.log(`  ❌ ${n}\n     ${d}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(label, ms, check) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = await check();
    if (hit) return hit;
    await sleep(4_000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const rootRow = () =>
  sb
    .from("channel_bot_sessions")
    .select("id, turn_state, pending_approval, turn_nonce, question_message_id")
    .eq("channel_id", CHANNEL_ID)
    .eq("thread_key", "_root")
    .maybeSingle()
    .then(({ data }) => data);

async function main() {
  console.log(`\nParked conversation question under MENTION mode — ${CHANNEL_ID}\n`);
  const channel = stream.channel("team", CHANNEL_ID);
  await channel.watch();

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

  // The mode the bug lives in.
  await channel.updatePartial({ set: { ai_mode: "mention" } });
  ok("channel set to mention mode");

  // A doc the bot can only finish with a fact nobody has recorded.
  const { data: doc } = await sb
    .from("documents")
    .insert({
      property_id: ch.property_id,
      title: "PARKCHAT — Callout numbers",
      created_by: member.user_id,
    })
    .select("id")
    .single();

  const botUser = await stream.queryUsers({ id: BOT_USER_ID });
  const before = new Date().toISOString();

  try {
    console.log("\n1. asking (with an @-mention) for something only a human knows…");
    await channel.sendMessage({
      text: `@hotelclaw add our refrigeration contractor's emergency call-out number to document ${doc.id}. It is not written down anywhere — do not invent one and do not leave a placeholder.`,
      user_id: TESTER,
      mentioned_users: [botUser.users[0]?.id ?? BOT_USER_ID],
    });

    const parked = await until("the bot to park on a question", 240_000, async () => {
      const r = await rootRow();
      return r?.pending_approval?.requests?.some?.((q) => q?.prompt) ? r : null;
    });
    ok("bot parked on a question rather than inventing a number");
    ok("turn slot released", `turn_state=${parked.turn_state}`);

    const st = await channel.query({ messages: { limit: 25 } });
    const question = (st.messages ?? []).find(
      (m) => m.user?.id === BOT_USER_ID && m.created_at > before && (m.text ?? "").trim(),
    );
    if (!question) bad("question posted to the channel", "no bot message found");
    else ok("question posted to the channel", `"${question.text.slice(0, 70)}…"`);

    // ── THE BUG ── answer with NO @-mention. Pre-fix this was dropped.
    console.log("\n2. answering WITHOUT an @-mention (this is the bug)…");
    await channel.sendMessage({
      text: `It's Coldline Refrigeration, ${NUMBER}.`,
      user_id: TESTER,
    });

    const resumed = await until("the bot to pick the answer up", 240_000, async () => {
      const r = await rootRow();
      return r && r.turn_nonce !== parked.turn_nonce ? r : null;
    });
    ok("unmentioned answer resumed the parked session", `nonce ${resumed.turn_nonce.slice(0, 8)}`);

    // And it must actually finish the work, not just acknowledge.
    const finished = await until("the doc to be written", 240_000, async () => {
      const { data: d } = await sb
        .from("documents")
        .select("body_text")
        .eq("id", doc.id)
        .single();
      return (d.body_text ?? "").replace(/\s+/g, " ").includes("555 9911") ? d : null;
    });
    ok("the work completed with OUR number", `${finished.body_text.length} chars written`);
    if (/TO CONFIRM|\bTBD\b/i.test(finished.body_text)) {
      bad("no placeholder in the deliverable", finished.body_text.slice(0, 200));
    } else ok("no placeholder in the deliverable");
  } finally {
    try {
      const { resolvePropertyBrain, callBrainTool } = await import(
        "../lib/brain/client.ts"
      );
      const binding = await resolvePropertyBrain(ch.property_id);
      if (binding) {
        await callBrainTool(binding, "delete_page", { slug: `documents/${doc.id}` });
      }
    } catch {
      /* best effort */
    }
    await sb.from("documents").delete().eq("id", doc.id);
    console.log("\n(test doc + brain mirror cleaned up)");
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
