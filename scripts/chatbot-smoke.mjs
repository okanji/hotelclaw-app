/**
 * Chatbot end-to-end smoke test — exercises the PUBLIC guest pipeline
 * against the running dev server (localhost:3000) with a throwaway bot:
 *
 *   1. seed: published room-service bot + trained knowledge chunk (service client)
 *   2. POST /api/guest/chatbots/:slug/session  → token + meta
 *   3. ask a knowledge question                → streamed answer from FTS
 *   4. place an order                          → create_ticket → tasks row +
 *                                                chatbot.order_created event
 *   5. custom HTTP action (dummyjson.com)      → tool call + encrypted-header
 *                                                roundtrip through the executor
 *   6. guest thumbs                            → PATCH feedback persists
 *   7. widget script + per-bot frame-ancestors CSP
 *   8. Twilio webhook (no creds → TwiML reply) → same pipeline, new channel
 *   9. handoff:true                            → status 'human' +
 *                                                guest_escalation notifications
 *  10. message while escalated                 → JSON {state:'human'} (muted)
 *  11. cleanup (bot cascade + created tasks)
 *
 * Run:  node --env-file=.env.local --no-network-family-autoselection scripts/chatbot-smoke.mjs
 * Needs: pnpm dev on :3000, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

/** Mirrors lib/chatbots/crypto.ts so the seeded custom action's header
 *  exercises the production decrypt path. */
function encryptSecret(plaintext) {
  const secret = process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  const key = createHash("sha256").update(`${secret}:chatbot-custom-actions`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function readStream(res) {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of res.body) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text;
}

async function send(slug, token, body) {
  const res = await fetch(`${BASE}/api/guest/chatbots/${slug}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { json: await res.json(), status: res.status };
  }
  return { text: await readStream(res), status: res.status };
}

const { data: property } = await supabase
  .from("properties")
  .select("id, name")
  .limit(1)
  .single();
if (!property) {
  console.error("No property found — seed the database first.");
  process.exit(1);
}
console.log(`Property: ${property.name} (${property.id})\n`);

// ── 1. Seed a published bot + trained knowledge ─────────────────────────
const config = {
  version: 1,
  instructions:
    "You are the in-room dining assistant. Take room-service orders: answer menu questions from the knowledge base, collect the guest's name and room number, confirm the order back, then file it as a ticket. You also take reservations for the property's bookable services (massage, bistro) using your booking tools. Keep replies to 1-3 sentences.",
  modelTier: "standard",
  greeting: "Hungry? I can take your order.",
  suggestedQuestions: ["What's on the menu?"],
  appearance: { displayName: "Room Service", avatarEmoji: "🍽️", theme: "warm" },
  guardrails: {
    onlyFromSources: true,
    fallbackMessage: "I can't help with that — let me get the team.",
    handoffMessage: "Connecting you with our team — they'll reply right here.",
  },
  actions: [
    { type: "answer_from_knowledge", enabled: true },
    {
      type: "collect_guest_info",
      enabled: true,
      whenToUse: "Get the guest's name and room number before placing an order.",
      config: { name: true, email: false, phone: false, room: true },
    },
    {
      type: "create_ticket",
      enabled: true,
      whenToUse:
        "When the guest has confirmed their order — include items, room, and notes.",
      config: { kind: "order", priority: "high", fields: [] },
    },
    {
      type: "escalate_to_human",
      enabled: true,
      whenToUse: "When the guest asks for a person or has a complaint.",
      config: { notifyRoles: ["owner", "manager"] },
    },
    {
      type: "book_service",
      enabled: true,
      whenToUse: "When the guest wants to book the massage or any bookable service.",
      config: { serviceIds: [], autoConfirm: true },
    },
  ],
};

const TWILIO_TEST_NUMBER = "whatsapp:+15550006661";
const { data: bot, error: botErr } = await supabase
  .from("chatbots")
  .insert({
    property_id: property.id,
    name: "Smoke Test Room Service",
    template: "room_service",
    config,
    status: "published",
    allowed_domains: ["https://example-hotel.test"],
    twilio_number: TWILIO_TEST_NUMBER,
  })
  .select("id, public_slug")
  .single();
if (botErr) {
  console.error("Bot insert failed:", botErr.message);
  process.exit(1);
}

const { data: source } = await supabase
  .from("chatbot_knowledge_sources")
  .insert({
    chatbot_id: bot.id,
    property_id: property.id,
    kind: "text",
    title: "Room service menu",
    content:
      "Room service menu: Classic burger with fries $24. Margherita pizza $19. Caesar salad $19. Breakfast is served 6:30am to 10:30am daily. A $5 tray charge applies to all orders.",
    status: "trained",
    char_count: 180,
  })
  .select("id")
  .single();
await supabase.from("chatbot_knowledge_chunks").insert({
  source_id: source.id,
  chatbot_id: bot.id,
  property_id: property.id,
  content:
    "Room service menu: Classic burger with fries $24. Margherita pizza $19. Caesar salad $19. Breakfast is served 6:30am to 10:30am daily. A $5 tray charge applies to all orders.",
});
check("seeded published bot + knowledge chunk", true, `slug ${bot.public_slug}`);

const startedAt = new Date().toISOString();
let createdTaskIds = [];

try {
  // ── 2. Session bootstrap ──────────────────────────────────────────────
  const sessionRes = await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: "204" }),
  });
  const session = await sessionRes.json();
  check(
    "session bootstrap",
    sessionRes.ok && !!session.token && !!session.conversationId,
    `status ${sessionRes.status}`,
  );
  const { token, conversationId } = session;

  // Wrong-token probe must 401.
  const badRes = await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer aaaa.bbbb.cccc",
    },
    body: JSON.stringify({ text: "hi" }),
  });
  check("forged session token rejected", badRes.status === 401, `status ${badRes.status}`);

  // ── 3. Knowledge question ─────────────────────────────────────────────
  const answer = await send(bot.public_slug, token, {
    text: "When is breakfast served?",
  });
  const answerText = answer.text ?? answer.json?.reply ?? "";
  check(
    "knowledge answer streams and cites the trained fact",
    typeof answer.text === "string" && /6:30|6\.30|10:30/i.test(answerText),
    JSON.stringify(answerText.slice(0, 120)),
  );

  // ── 3b. Custom HTTP action (live API + encrypted header roundtrip) ───
  await supabase.from("chatbot_custom_actions").insert({
    chatbot_id: bot.id,
    property_id: property.id,
    name: "Product lookup",
    when_to_use:
      "When the guest asks about a product from the gift-shop catalog by its number.",
    method: "GET",
    url: "https://dummyjson.com/products/{{product_id}}",
    headers: [{ name: "X-Smoke-Test", value_encrypted: encryptSecret("hotelclaw") }],
    param_schema: [
      {
        id: "p_product",
        name: "product_id",
        type: "number",
        description: "The catalog product number",
        required: true,
      },
    ],
    response_allowlist: ["title", "price"],
    enabled: true,
  });
  const productAnswer = await send(bot.public_slug, token, {
    text: "Can you look up product number 1 in the gift-shop catalog and tell me its price?",
  });
  const productText = productAnswer.text ?? productAnswer.json?.reply ?? "";
  check(
    "custom API action called and answer cites live response",
    /9\.99|essence|mascara/i.test(productText),
    JSON.stringify(productText.slice(0, 120)),
  );

  // ── 3c. Guest thumbs feedback ─────────────────────────────────────────
  const listRes = await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = await listRes.json();
  const lastBotMsg = (list.messages ?? []).filter((m) => m.role === "bot").at(-1);
  const fbRes = await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/messages`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messageId: lastBotMsg?.id, feedback: 1 }),
  });
  const { data: fbRow } = await supabase
    .from("chatbot_messages")
    .select("feedback")
    .eq("id", lastBotMsg?.id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check(
    "guest thumbs-up persisted on the bot message",
    fbRes.ok && fbRow?.feedback === 1,
    `status ${fbRes.status} feedback=${fbRow?.feedback}`,
  );

  // ── 3d. Widget script + per-bot embed CSP ─────────────────────────────
  const widgetRes = await fetch(`${BASE}/chatbot-widget.js`);
  const widgetSrc = widgetRes.ok ? await widgetRes.text() : "";
  check(
    "embed widget script served",
    widgetRes.ok && widgetSrc.includes("data-chatbot"),
    `status ${widgetRes.status}`,
  );
  const pageRes = await fetch(`${BASE}/g/${bot.public_slug}`, { redirect: "manual" });
  const csp = pageRes.headers.get("content-security-policy") ?? "";
  check(
    "guest page carries per-bot frame-ancestors CSP",
    csp.includes("frame-ancestors") && csp.includes("example-hotel.test"),
    JSON.stringify(csp),
  );

  // ── 3e. Twilio webhook (no creds → synchronous TwiML) ────────────────
  const twilioRes = await fetch(`${BASE}/api/guest/channels/twilio`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      From: "whatsapp:+15557654321",
      To: TWILIO_TEST_NUMBER,
      Body: "When is breakfast served?",
    }),
  });
  const twiml = await twilioRes.text();
  const { data: waConvo } = await supabase
    .from("chatbot_conversations")
    .select("id, channel")
    .eq("chatbot_id", bot.id)
    .eq("session_token", "whatsapp:+15557654321")
    .maybeSingle();
  check(
    "Twilio webhook answers via TwiML on a whatsapp conversation",
    twilioRes.ok && /<Message>/.test(twiml) && /6:30|10:30/.test(twiml) && waConvo?.channel === "whatsapp",
    `channel=${waConvo?.channel} ${JSON.stringify(twiml.slice(0, 140))}`,
  );

  // ── 3f. Booking flow (deterministic availability + slot consumption) ─
  const allDay = { start: "09:00", end: "17:00" };
  const { data: smokeService } = await supabase
    .from("bookable_services")
    .insert({
      property_id: property.id,
      name: "Smoke Massage",
      kind: "appointment",
      timezone: "UTC",
      schedule: {
        version: 1,
        slotIntervalMinutes: 60,
        durationMinutes: 60,
        capacityPerSlot: 1,
        countPartySize: false,
        maxPartySize: 2,
        minNoticeMinutes: 0,
        horizonDays: 30,
        weekly: {
          mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay],
          fri: [allDay], sat: [allDay], sun: [allDay],
        },
      },
    })
    .select("id")
    .single();
  const bookDate = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  await send(bot.public_slug, token, {
    text: `Please book the Smoke Massage on ${bookDate} at 14:00 for one person. My name is Alex.`,
  });
  // The bot restates and asks for explicit confirmation before booking
  // (by design) — give it the yes.
  const bookingReply = await send(bot.public_slug, token, {
    text: "Yes, that's right — please confirm the booking.",
  });
  const bookingText = bookingReply.text ?? bookingReply.json?.reply ?? "";
  // "Z" form — a "+00:00" offset in a PostgREST filter param decodes the
  // "+" as a space and silently matches nothing.
  const slotStart = `${bookDate}T14:00:00Z`;
  const slotEnd = `${bookDate}T15:00:00Z`;
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id, status, source, reference, guest_name")
    .eq("service_id", smokeService.id)
    .gte("starts_at", slotStart)
    .lt("starts_at", slotEnd);
  check(
    "bot booked the 14:00 slot (confirmed, source chatbot)",
    bookingRows?.length === 1 &&
      bookingRows[0].status === "confirmed" &&
      bookingRows[0].source === "chatbot",
    bookingRows?.[0]
      ? `${bookingRows[0].reference} guest=${bookingRows[0].guest_name}`
      : JSON.stringify(bookingText.slice(0, 120)),
  );
  const { data: bookingEvents } = await supabase
    .from("workflow_events")
    .select("id")
    .eq("property_id", property.id)
    .eq("event_type", "booking.created")
    .gte("received_at", startedAt);
  check("booking.created workflow event emitted", (bookingEvents ?? []).length > 0);

  // Second guest, same slot — capacity 1 must hold.
  const session2 = await (
    await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  await send(bot.public_slug, session2.token, {
    text: `Please book the Smoke Massage on ${bookDate} at 14:00 for one person. My name is Sam.`,
  });
  await send(bot.public_slug, session2.token, {
    text: "Yes, go ahead and book whatever you can.",
  });
  const { data: afterSecond } = await supabase
    .from("bookings")
    .select("id")
    .eq("service_id", smokeService.id)
    .in("status", ["pending", "confirmed"])
    .gte("starts_at", slotStart)
    .lt("starts_at", slotEnd);
  check(
    "double-booking the full slot is rejected (capacity holds at 1)",
    (afterSecond ?? []).length === 1,
    `${afterSecond?.length} active booking(s) in the 14:00 slot`,
  );

  // ── 3g. Booking questions — an attached form the bot collects in chat ─
  const { data: smokeForm } = await supabase
    .from("forms")
    .insert({
      property_id: property.id,
      title: "Massage intake",
      status: "published",
      created_by: null,
      schema: {
        version: 1,
        fields: [
          {
            id: "focus",
            type: "select",
            label: "Focus area",
            required: true,
            options: [
              { id: "back", label: "Back" },
              { id: "shoulders", label: "Shoulders" },
              { id: "fullbody", label: "Full body" },
            ],
          },
          { id: "injuries", type: "yes_no", label: "Any recent injuries?" },
        ],
      },
    })
    .select("id, schema")
    .single();
  // Attach the form to the service (what the service dialog does).
  const { data: svcForForm } = await supabase
    .from("bookable_services")
    .select("schedule")
    .eq("id", smokeService.id)
    .single();
  await supabase
    .from("bookable_services")
    .update({ schedule: { ...svcForForm.schedule, formId: smokeForm.id } })
    .eq("id", smokeService.id);

  const session3 = await (
    await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  // Give the bot everything incl. the intake answers up front. Booking
  // questions add a confirmation round, so allow a few turns to land it.
  await send(bot.public_slug, session3.token, {
    text: `Book the Smoke Massage on ${bookDate} at 15:00 for one, name Jordan. For the intake: focus on my back, and no recent injuries.`,
  });
  await send(bot.public_slug, session3.token, {
    text: "Yes, that's right — please confirm and book it.",
  });
  await send(bot.public_slug, session3.token, {
    text: "Yes, book it now please.",
  });
  const slot3Start = `${bookDate}T15:00:00Z`;
  const slot3End = `${bookDate}T16:00:00Z`;
  const { data: formBookingRows } = await supabase
    .from("bookings")
    .select("id, reference, notes, status")
    .eq("service_id", smokeService.id)
    .gte("starts_at", slot3Start)
    .lt("starts_at", slot3End);
  const formBooking = formBookingRows?.[0];
  check(
    "bot booked the slot AND captured the intake answers in notes",
    Boolean(formBooking) && /focus area/i.test(formBooking?.notes ?? ""),
    formBooking
      ? `${formBooking.reference} notes=${JSON.stringify((formBooking.notes ?? "").slice(0, 120))}`
      : "no booking at 15:00 — bot may not have collected the required answer",
  );
  const { data: formResponses } = await supabase
    .from("form_responses")
    .select("id, source, answers")
    .eq("form_id", smokeForm.id)
    .eq("source", "booking");
  const fr = formResponses?.[0];
  check(
    "form_responses row written (source 'booking') tied to the booking",
    Boolean(fr) &&
      fr?.answers?.focus === "back" &&
      fr?.answers?._booking_reference === formBooking?.reference,
    fr ? JSON.stringify(fr.answers) : "no booking-source response row",
  );

  await supabase.from("forms").delete().eq("id", smokeForm.id);
  await supabase.from("bookable_services").delete().eq("id", smokeService.id);

  // ── 3g. Table-mode booking: best-fit assignment + per-table conflicts ─
  const { data: bistro } = await supabase
    .from("bookable_services")
    .insert({
      property_id: property.id,
      name: "Smoke Bistro",
      kind: "table",
      booking_mode: "tables",
      timezone: "UTC",
      schedule: {
        version: 1,
        slotIntervalMinutes: 30,
        durationMinutes: 90,
        capacityPerSlot: 10,
        countPartySize: true,
        maxPartySize: 6,
        minNoticeMinutes: 0,
        horizonDays: 30,
        weekly: {
          mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay],
          fri: [allDay], sat: [allDay], sun: [allDay],
        },
      },
    })
    .select("id")
    .single();
  const { data: smokeTables } = await supabase
    .from("service_resources")
    .insert([
      { service_id: bistro.id, property_id: property.id, name: "T1", seats: 2 },
      { service_id: bistro.id, property_id: property.id, name: "T2", seats: 4 },
    ])
    .select("id, name");
  const tableIds = new Map(smokeTables.map((t) => [t.name, t.id]));

  const bookTable = async (guest) => {
    const sess = await (
      await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json();
    await send(bot.public_slug, sess.token, {
      text: `Book the Smoke Bistro on ${bookDate} at 12:00 for two people. My name is ${guest}, phone +1 555 0100.`,
    });
    const r = await send(bot.public_slug, sess.token, {
      text: "Yes, confirm it please.",
    });
    return r.text ?? r.json?.reply ?? "";
  };
  const tableReply1 = await bookTable("Kim");
  const tableReply2 = await bookTable("Lee");
  const { data: bistroBookings } = await supabase
    .from("bookings")
    .select("resource_id")
    .eq("service_id", bistro.id)
    .in("status", ["pending", "confirmed", "seated"]);
  const assigned = (bistroBookings ?? []).map((b) => b.resource_id);
  check(
    "table mode: two same-slot bookings land on distinct best-fit tables (T1 then T2)",
    assigned.length === 2 &&
      new Set(assigned).size === 2 &&
      assigned.includes(tableIds.get("T1")) &&
      assigned.includes(tableIds.get("T2")),
    assigned.length === 2
      ? `assigned=${assigned.map((id) => [...tableIds.entries()].find(([, v]) => v === id)?.[0] ?? "none").join(",")}`
      : `bookings=${assigned.length} reply1=${JSON.stringify(tableReply1.slice(0, 80))} reply2=${JSON.stringify(tableReply2.slice(0, 80))}`,
  );
  await supabase.from("bookable_services").delete().eq("id", bistro.id);

  // ── 4. Order → ticket ────────────────────────────────────────────────
  await send(bot.public_slug, token, {
    text: "I'd like a classic burger to room 204 please. My name is Alex.",
  });
  const confirm = await send(bot.public_slug, token, {
    text: "Yes, that's everything — please place the order.",
  });
  const confirmText = confirm.text ?? confirm.json?.reply ?? "";
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, source, priority")
    .eq("property_id", property.id)
    .eq("source", "ai")
    .gte("created_at", startedAt);
  createdTaskIds = (tasks ?? []).map((t) => t.id);
  check(
    "order created a task (source: ai)",
    (tasks ?? []).length > 0,
    tasks?.[0] ? `"${tasks[0].title}" priority=${tasks[0].priority}` : JSON.stringify(confirmText.slice(0, 120)),
  );

  const { data: convoAfterOrder } = await supabase
    .from("chatbot_conversations")
    .select("outcome, guest_name, room_number, outcome_meta")
    .eq("id", conversationId)
    .single();
  check(
    "conversation outcome flipped to order_placed",
    convoAfterOrder?.outcome === "order_placed",
    `outcome=${convoAfterOrder?.outcome} guest=${convoAfterOrder?.guest_name} room=${convoAfterOrder?.room_number}`,
  );

  const { data: orderEvents } = await supabase
    .from("workflow_events")
    .select("id, event_type")
    .eq("property_id", property.id)
    .eq("event_type", "chatbot.order_created")
    .gte("received_at", startedAt);
  check(
    "chatbot.order_created workflow event emitted",
    (orderEvents ?? []).length > 0,
  );

  // ── 5. Guest-button handoff ───────────────────────────────────────────
  const handoff = await send(bot.public_slug, token, { handoff: true });
  check(
    "handoff returns state human",
    handoff.json?.state === "human",
    JSON.stringify(handoff.json),
  );
  const { data: convoAfterHandoff } = await supabase
    .from("chatbot_conversations")
    .select("status, outcome")
    .eq("id", conversationId)
    .single();
  check(
    "conversation status flipped to human + outcome escalated",
    convoAfterHandoff?.status === "human" && convoAfterHandoff?.outcome === "escalated",
    `status=${convoAfterHandoff?.status} outcome=${convoAfterHandoff?.outcome}`,
  );
  const { data: escalations } = await supabase
    .from("notifications")
    .select("id, user_id")
    .eq("type", "guest_escalation")
    .gte("created_at", startedAt);
  check(
    "guest_escalation notifications created for owners/managers",
    (escalations ?? []).length > 0,
    `${escalations?.length ?? 0} recipients`,
  );

  // ── 6. Bot is structurally muted while escalated ──────────────────────
  const muted = await send(bot.public_slug, token, { text: "hello?" });
  check(
    "guest message while escalated returns {state:'human'} without a model call",
    muted.json?.state === "human",
    JSON.stringify(muted.json),
  );

  // GET sync sees the guest message + status.
  const syncRes = await fetch(
    `${BASE}/api/guest/chatbots/${bot.public_slug}/messages`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const sync = await syncRes.json();
  check(
    "GET sync returns transcript + human status",
    sync.status === "human" && Array.isArray(sync.messages) && sync.messages.length >= 4,
    `status=${sync.status} messages=${sync.messages?.length}`,
  );

  // Draft bots 404 on the guest surface.
  await supabase.from("chatbots").update({ status: "draft" }).eq("id", bot.id);
  const draftRes = await fetch(`${BASE}/api/guest/chatbots/${bot.public_slug}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  check("draft bot 404s on the public API", draftRes.status === 404, `status ${draftRes.status}`);
} finally {
  // ── 7. Cleanup ────────────────────────────────────────────────────────
  await supabase.from("chatbots").delete().eq("id", bot.id);
  if (createdTaskIds.length > 0) {
    await supabase.from("tasks").delete().in("id", createdTaskIds);
  }
  await supabase
    .from("notifications")
    .delete()
    .eq("type", "guest_escalation")
    .gte("created_at", startedAt);
  console.log("\n🧹 cleaned up (bot cascade, tasks, notifications)");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
