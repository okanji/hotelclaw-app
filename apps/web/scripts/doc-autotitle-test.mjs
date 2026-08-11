#!/usr/bin/env node
/**
 * update_document AUTO-TITLES an "Untitled" doc from its own heading.
 *
 * The persona has told the model to fix untitled docs since 2026-07-25 and it
 * still shipped them: on 2026-08-11 a background job wrote a complete
 * walk-in-freezer SOP into a doc whose record title was — and stayed —
 * "Untitled document", so it read as untitled in every list, search result,
 * artifact card and brain page. A rule the model must remember is a rule that
 * gets dropped under load, so the derivation now lives in the executor.
 *
 * Drives a REAL eve channel-bot session (no Stream webhook needed) and
 * asserts the DB row, never the bot's claim.
 *
 *   node --env-file=.env.local --no-network-family-autoselection \
 *     scripts/doc-autotitle-test.mjs
 */
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.env.TEST_ORIGIN ?? "http://127.0.0.1:3000";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHANNEL_ID =
  process.env.TEST_CHANNEL ?? "prop-697681e8-food-and-beverage-5d05af";
const HEADING = "SOP: Chemical Storage & COSHH Handling";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (n, x = "") => console.log(`  ✅ ${n}${x ? ` — ${x}` : ""}`);
const bad = (n, d) => {
  failures++;
  console.log(`  ❌ ${n}\n     ${d}`);
};

async function main() {
  const { data: chatChannel } = await sb
    .from("chat_channels")
    .select("property_id")
    .eq("stream_channel_id", CHANNEL_ID)
    .maybeSingle();
  if (!chatChannel) throw new Error(`no chat_channels row for ${CHANNEL_ID}`);
  const propertyId = chatChannel.property_id;
  const { data: member } = await sb
    .from("memberships")
    .select("user_id")
    .eq("property_id", propertyId)
    .in("role", ["owner", "manager"])
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  // A stub doc in exactly the state the incident produced: real record, no
  // title anyone can read.
  const { data: doc, error } = await sb
    .from("documents")
    .insert({
      property_id: propertyId,
      title: "Untitled document",
      created_by: member.user_id,
    })
    .select("id, title")
    .single();
  if (error) throw new Error(`doc insert failed: ${error.message}`);
  console.log(`\nstub doc ${doc.id} — title ${JSON.stringify(doc.title)}\n`);

  try {
    const nonce = crypto.randomUUID();
    const res = await fetch(`${ORIGIN}/eve/v1/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SERVICE_KEY}`,
        "x-hotelclaw-property": propertyId,
        "x-hotelclaw-user": member.user_id,
        "x-hotelclaw-bot": "hotelclaw",
        "x-hotelclaw-channel": CHANNEL_ID,
        "x-hotelclaw-sender": member.user_id,
      },
      body: JSON.stringify({
        message: [
          `[turn ${nonce} — internal marker, ignore]`,
          // Deliberately does NOT mention the title: the whole point is that
          // the model doesn't have to think of it.
          `Write this into document ${doc.id}, replacing the body. Do not ask me anything, just write it:`,
          `<h1>${HEADING}</h1><p>Store all cleaning chemicals in the locked COSHH cupboard by the loading bay.</p><p>Never decant into unlabelled containers.</p>`,
        ].join("\n\n"),
      }),
    });
    if (!res.ok) throw new Error(`session create failed: ${res.status}`);
    console.log("waiting for the write (up to 3 min)…");

    let final = null;
    for (let i = 0; i < 36; i++) {
      await sleep(5_000);
      const { data: row } = await sb
        .from("documents")
        .select("title, body_text")
        .eq("id", doc.id)
        .single();
      if ((row.body_text ?? "").includes("COSHH cupboard")) {
        final = row;
        break;
      }
    }
    if (!final) throw new Error("the write never landed");

    ok("body written", `${final.body_text.length} chars`);
    if (final.title === HEADING) {
      ok("record title auto-derived from the body heading", JSON.stringify(final.title));
    } else if (/^untitled/i.test(final.title)) {
      bad("record title auto-derived", `still ${JSON.stringify(final.title)}`);
    } else {
      // The model passing new_title itself is also a pass — the doc is named.
      ok("record title set (model supplied it)", JSON.stringify(final.title));
    }
  } finally {
    await sb.from("documents").delete().eq("id", doc.id);
    console.log("\n(stub doc cleaned up)");
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
