// In-channel custom-bot deployment harness — exercises the EVE path for
// chatbot_channel_deployments end-to-end over real Stream messages:
//   persona swap → knowledge search → custom HTTP action (encrypted header,
//   live dummyjson call) → brain access → durable-session continuity.
//
// Prereqs: dev server on :3000 with eve mounted, ngrok tunnel up, Stream
// webhook pointing at dev (configure-stream-webhook.mjs dev — put it BACK
// with `prod` when done), .env.local loaded via --env-file.
//
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/channel-deployment-test.mjs [--channel <id>]

import { createClient } from "@supabase/supabase-js";
import { StreamChat } from "stream-chat";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

const CHANNEL =
  process.argv.includes("--channel")
    ? process.argv[process.argv.indexOf("--channel") + 1]
    : "prop-697681e8-food-and-beverage-5d05af";
const PROPERTY_ID = "697681e8-731e-412a-8a9b-d6450360c219"; // Temple Point (owns the default test channel)
const BOT_USER_ID = process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai";
const TEST_USER_ID = "ai-bot-test-user";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const stream = StreamChat.getInstance(
  process.env.NEXT_PUBLIC_STREAM_API_KEY ?? process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);
const channel = stream.channel("team", CHANNEL);

// Mirror of lib/chatbots/crypto.ts (context "chatbot-custom-actions").
function encryptSecret(plaintext) {
  const secret = process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  const key = createHash("sha256").update(`${secret}:chatbot-custom-actions`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function resetSession() {
  await supabase.from("channel_bot_sessions").delete().eq("channel_id", CHANNEL);
}

/** Send a mention as the test user, wait for the next bot reply after it. */
async function ask(text, timeoutMs = 120_000) {
  const { message } = await channel.sendMessage({
    text,
    user_id: TEST_USER_ID,
    mentioned_users: [BOT_USER_ID],
  });
  const sentAt = new Date(message.created_at).getTime();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const state = await channel.query({ messages: { limit: 10 } });
    const reply = (state.messages ?? [])
      .filter((m) => m.user?.id === BOT_USER_ID)
      .filter((m) => new Date(m.created_at).getTime() > sentAt)
      .at(-1);
    if (reply?.text) return reply.text;
  }
  return null;
}

// ── Seed ─────────────────────────────────────────────────────────────────
const { data: bot, error: botErr } = await supabase
  .from("chatbots")
  .insert({
    property_id: PROPERTY_ID,
    name: "Marlin (deployment smoke)",
    template: "custom",
    config: {
      version: 1,
      instructions:
        "You are Marlin, the food & beverage specialist bot for this property. Always identify yourself as Marlin when asked who you are.",
      modelTier: "standard",
      actions: [{ type: "answer_from_knowledge", enabled: true }],
    },
    status: "published",
  })
  .select("id, public_slug")
  .single();
if (botErr) {
  console.error("bot insert failed:", botErr.message);
  process.exit(1);
}

const { data: source } = await supabase
  .from("chatbot_knowledge_sources")
  .insert({
    chatbot_id: bot.id,
    property_id: PROPERTY_ID,
    kind: "text",
    title: "Cellar handbook",
    content: "The staff cellar access code is GRAPE-42. Wine deliveries arrive Tuesdays.",
    status: "trained",
    char_count: 80,
  })
  .select("id")
  .single();
await supabase.from("chatbot_knowledge_chunks").insert({
  source_id: source.id,
  chatbot_id: bot.id,
  property_id: PROPERTY_ID,
  content: "The staff cellar access code is GRAPE-42. Wine deliveries arrive Tuesdays.",
});

await supabase.from("chatbot_custom_actions").insert({
  chatbot_id: bot.id,
  property_id: PROPERTY_ID,
  name: "Product lookup",
  when_to_use: "When staff ask about a gift-shop product by its catalog number.",
  method: "GET",
  url: "https://dummyjson.com/products/{{product_id}}",
  headers: [{ name: "X-Smoke-Test", value_encrypted: encryptSecret("hotelclaw") }],
  param_schema: [
    { id: "p", name: "product_id", type: "number", description: "Catalog number", required: true },
  ],
  response_allowlist: ["title", "price"],
  enabled: true,
});

const { error: depErr } = await supabase.from("chatbot_channel_deployments").insert({
  chatbot_id: bot.id,
  property_id: PROPERTY_ID,
  stream_channel_id: CHANNEL,
});
if (depErr) {
  console.error("deployment insert failed (another bot deployed here?):", depErr.message);
  await supabase.from("chatbots").delete().eq("id", bot.id);
  process.exit(1);
}
await resetSession();
console.log(`seeded bot ${bot.id} deployed to ${CHANNEL}\n`);

try {
  // a. Persona swap.
  const who = await ask("@hotelclaw who are you? One line.");
  check("persona: replies as the deployed bot", /marlin/i.test(who ?? ""), JSON.stringify(who?.slice(0, 120)));

  // b. Knowledge search.
  const cellar = await ask("@hotelclaw call your search_knowledge tool for 'cellar access code' and tell me what it returns.");
  check("knowledge: cites the trained fact", /grape-?42/i.test(cellar ?? ""), JSON.stringify(cellar?.slice(0, 120)));

  // c. Custom HTTP action (live).
  const product = await ask("@hotelclaw use your product lookup integration for product number 1 and tell me its title and price.");
  check("custom action: live dummyjson call", /9\.99|essence|mascara/i.test(product ?? ""), JSON.stringify(product?.slice(0, 140)));

  // d. Brain access (the point of the migration).
  const brain = await ask("@hotelclaw do you have knowledge-brain tools mounted? If yes call brain_search for 'wine' and report the raw result honestly.");
  check(
    "brain: deployed bot has brain tools and answers honestly",
    /brain/i.test(brain ?? "") && !/no brain|don't have|do not have/i.test(brain ?? ""),
    JSON.stringify(brain?.slice(0, 160)),
  );

  // e. Durable session: one row, stable eve session across all turns.
  const { data: sessions } = await supabase
    .from("channel_bot_sessions")
    .select("eve_session_id, thread_key")
    .eq("channel_id", CHANNEL);
  check(
    "durability: single eve session served every turn",
    (sessions ?? []).length === 1 && !!sessions[0].eve_session_id,
    JSON.stringify(sessions),
  );
} finally {
  await supabase.from("chatbot_channel_deployments").delete().eq("chatbot_id", bot.id);
  await supabase.from("chatbots").delete().eq("id", bot.id);
  await resetSession();
  console.log("\ncleaned up (deployment + bot deleted, session reset)");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
