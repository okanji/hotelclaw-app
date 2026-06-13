/**
 * Chatbots demo seeder — guest-facing bots with trained knowledge, realistic
 * guest conversations, thumbs feedback, and 14 days of usage so every
 * chatbot surface has something to show:
 *
 *   • Chatbots list (Live / Drafts) — 3 published + 1 draft
 *   • Bot detail → Knowledge panel (text + Q&A sources, "trained")
 *   • Bot detail → Conversations + transcript (guest/bot turns, outcomes)
 *   • Bot detail → Analytics (topics, sentiment bars, 14-day volume,
 *     orders placed, escalations, thumbs up/down)
 *   • Conversations list (cross-bot guest inbox)
 *
 * Seeds the deterministic DB rows only — it does NOT call the live model
 * (no ANTHROPIC needed). Conversations carry pre-labeled topic/sentiment so
 * the analytics dashboard is populated without the lazy classifier pass.
 *
 * Re-runnable: deletes the demo bots by name first (knowledge, conversations,
 * messages, usage all cascade).
 *
 * Run: node --env-file=.env.local --no-network-family-autoselection scripts/seed-chatbots-demo.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";

const PROPERTY_ID =
  process.env.SEED_PROPERTY_ID ?? "d58fc73b-9077-404d-9f2b-6eb56902d91a";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: property } = await supabase
  .from("properties")
  .select("id, name")
  .eq("id", PROPERTY_ID)
  .single();
if (!property) {
  console.error(`Property ${PROPERTY_ID} not found.`);
  process.exit(1);
}
console.log(`Seeding chatbots demo into ${property.name}\n`);

const { data: members } = await supabase
  .from("memberships")
  .select("user_id")
  .eq("property_id", PROPERTY_ID);
const memberIds = (members ?? []).map((m) => m.user_id);
const creator = memberIds[0] ?? null;

// Real service / space ids on this property (wired into bot actions).
const { data: services } = await supabase
  .from("bookable_services")
  .select("id, name")
  .eq("property_id", PROPERTY_ID);
const svc = (name) =>
  services?.find((s) => s.name.toLowerCase().includes(name))?.id;
const { data: spaces } = await supabase
  .from("spaces")
  .select("id, name")
  .eq("property_id", PROPERTY_ID);
const space = (name) =>
  spaces?.find((s) => s.name.toLowerCase().includes(name))?.id;

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const dayStr = (d) =>
  new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);

// ── Bot definitions ─────────────────────────────────────────────────────────

const BOTS = [
  {
    name: "Solana Cove Concierge",
    template: "front_desk",
    status: "published",
    config: {
      version: 1,
      instructions:
        "You are the front-desk concierge for Solana Cove Resort & Spa, a luxury beachfront resort. Answer guest questions warmly and concisely from the knowledge base. You can book the spa, the sunset kayak tour, and a table at The Terrace. Escalate anything you can't resolve to the front-office team. Never invent rates or availability — use your tools.",
      modelTier: "advanced",
      greeting:
        "Welcome to Solana Cove! 🌊 I can help with check-in, amenities, or booking the spa, a kayak tour, or dinner. What can I do for you?",
      suggestedQuestions: [
        "What time is check-in?",
        "Book a couples massage",
        "Is there a kids' club?",
        "How do I get to the resort?",
      ],
      appearance: {
        displayName: "Cove Concierge",
        avatarEmoji: "🛎️",
        theme: "warm",
        brandColor: "#0ea5e9",
      },
      guardrails: {
        onlyFromSources: false,
        fallbackMessage:
          "Let me connect you with our front-office team for that.",
        handoffMessage:
          "I'm bringing in a team member — they'll reply right here shortly.",
      },
      actions: [
        { type: "answer_from_knowledge", enabled: true },
        {
          type: "collect_guest_info",
          enabled: true,
          whenToUse: "Before booking, get the guest's name and room number.",
          config: { name: true, email: true, phone: false, room: true },
        },
        {
          type: "book_service",
          enabled: true,
          whenToUse:
            "When the guest wants the spa, kayak tour, or a dinner table.",
          config: {
            serviceIds: [
              svc("serenity spa"),
              svc("kayak"),
              svc("terrace"),
            ].filter(Boolean),
            autoConfirm: false,
          },
        },
        {
          type: "escalate_to_human",
          enabled: true,
          whenToUse: "Complaints, billing disputes, or anything unresolved.",
          config: { notifyRoles: ["owner", "manager"] },
        },
      ],
    },
    knowledge: [
      {
        kind: "text",
        title: "Arrival & departure",
        content:
          "Check-in is from 3:00 PM; check-out is by 11:00 AM. Early check-in and late check-out are subject to availability — ask the front desk. Luggage storage is complimentary. Welcome drinks are served in the lobby lounge until 6 PM.",
      },
      {
        kind: "text",
        title: "Amenities & hours",
        content:
          "The infinity pool is open 7 AM–9 PM. Serenity Spa runs 9 AM–8 PM. The fitness center is 24/7 with a key card. Beach towels are at the pool hut. Complimentary high-speed WiFi: network 'SolanaCove-Guest', password 'seabreeze2026'. Valet parking is $35/night; self-parking is $20/night.",
      },
      {
        kind: "qa",
        title: "Pets policy",
        question: "Are pets allowed at the resort?",
        content:
          "Solana Cove is pet-friendly for dogs under 40 lbs in garden-view rooms only, with a $75/stay cleaning fee. Service animals are always welcome at no charge. Villas and oceanfront rooms are pet-free.",
      },
      {
        kind: "qa",
        title: "Getting here",
        question: "How do I get to the resort from the airport?",
        content:
          "We're 35 minutes from the international airport. A resort shuttle runs on the hour 7 AM–10 PM ($25pp, book at the desk). Taxis are ~$55. If driving, parking is on-site.",
      },
      {
        kind: "qa",
        title: "Kids' club",
        question: "Is there a kids' club or childcare?",
        content:
          "The Coral Kids Club (ages 4–12) runs 9 AM–5 PM daily, included in your stay. Evening babysitting is available with 4 hours' notice at $30/hour through the concierge.",
      },
    ],
    conversations: [
      {
        guest: "Marina Delgado",
        room: "412",
        topic: "Check-in & arrival",
        sentiment: "positive",
        outcome: "resolved",
        ageH: 3,
        turns: [
          ["guest", "Hi! What time can we check in tomorrow?"],
          [
            "bot",
            "Welcome! Check-in opens at 3:00 PM. If you arrive early we'll happily store your luggage and you can enjoy the pool or lobby lounge in the meantime. Would you like me to request an early check-in?",
            1,
          ],
          ["guest", "Yes please, our flight lands at noon."],
          [
            "bot",
            "Noted — I've flagged an early check-in request for your noon arrival (subject to availability). The front desk will confirm at arrival. Anything else I can set up?",
          ],
          ["guest", "That's perfect, thank you!"],
        ],
      },
      {
        guest: "Tom & Priya Anand",
        room: "Villa 2",
        topic: "Spa booking",
        sentiment: "positive",
        outcome: "order_placed",
        ageH: 9,
        turns: [
          ["guest", "We'd love a couples massage this week."],
          [
            "bot",
            "Wonderful choice — our 60-minute couples massage at Serenity Spa is very popular. What day and time work best for you?",
          ],
          ["guest", "Thursday around 4pm if possible."],
          [
            "bot",
            "I have Thursday 4:00 PM available for two. I've placed a pending hold under Villa 2 — the spa team will confirm shortly. You'll get a reminder an hour before. 💆",
            1,
          ],
        ],
      },
      {
        guest: "Greg Mason",
        room: "305",
        topic: "WiFi & amenities",
        sentiment: "neutral",
        outcome: "resolved",
        ageH: 26,
        turns: [
          ["guest", "what's the wifi password"],
          [
            "bot",
            "Connect to 'SolanaCove-Guest' and use the password seabreeze2026. It's complimentary and high-speed throughout the resort. Let me know if you have any trouble connecting!",
          ],
          ["guest", "got it thanks"],
        ],
      },
      {
        guest: "Hannah Vogel",
        room: "118",
        topic: "Billing dispute",
        sentiment: "negative",
        outcome: "escalated",
        ageH: 30,
        turns: [
          ["guest", "I was charged twice for the minibar and that's not right."],
          [
            "bot",
            "I'm sorry about that — a duplicate minibar charge isn't something I can reverse myself, so I'm connecting you with our front-office team right now to sort it out.",
            -1,
          ],
          ["guest", "Please hurry, we're checking out in an hour."],
          [
            "staff",
            "Hi Hannah, this is Priya at the front desk — I see the duplicate charge and I'm reversing it now. You'll see it drop off before checkout. So sorry for the hassle!",
          ],
        ],
      },
      {
        guest: "Walk-in (lobby QR)",
        room: null,
        topic: "Getting here",
        sentiment: "positive",
        outcome: "resolved",
        ageH: 50,
        turns: [
          ["guest", "Does the airport shuttle need booking?"],
          [
            "bot",
            "Yes — the shuttle runs hourly 7 AM–10 PM at $25 per person, and we recommend booking at the front desk so we hold your seats. A taxi is about $55 if you'd rather go direct. Shall I note a shuttle request for you?",
            1,
          ],
          ["guest", "No thanks, just checking. Appreciate it!"],
        ],
      },
    ],
  },
  {
    name: "In-Room Dining",
    template: "room_service",
    status: "published",
    config: {
      version: 1,
      instructions:
        "You take in-room dining orders for Solana Cove. Answer menu questions from the knowledge base, collect the guest's name and room number, confirm the order and total back to them, then file it as a ticket for the kitchen. Mention the $6 tray charge. Keep replies short and friendly.",
      modelTier: "standard",
      greeting: "Hungry? 🍽️ I can take your in-room dining order any time.",
      suggestedQuestions: [
        "What's on the menu?",
        "Do you have vegan options?",
        "How late is room service?",
      ],
      appearance: { displayName: "Room Service", avatarEmoji: "🍽️", theme: "warm" },
      guardrails: {
        onlyFromSources: true,
        fallbackMessage:
          "I can only help with in-room dining — let me get the team for that.",
        handoffMessage: "Connecting you with our team — one moment.",
      },
      actions: [
        { type: "answer_from_knowledge", enabled: true },
        {
          type: "collect_guest_info",
          enabled: true,
          whenToUse: "Get the guest's name and room before placing an order.",
          config: { name: true, email: false, phone: false, room: true },
        },
        {
          type: "create_ticket",
          enabled: true,
          whenToUse:
            "Once the guest confirms the order — include items, room, and total.",
          config: {
            kind: "order",
            priority: "high",
            spaceId: space("food"),
            fields: [
              { id: "tf_items", label: "Items ordered", required: true },
              { id: "tf_room", label: "Room number", required: true },
            ],
          },
        },
      ],
    },
    knowledge: [
      {
        kind: "text",
        title: "In-room dining menu",
        content:
          "All-day menu: Cove Burger with fries $26. Margherita flatbread $21. Caesar salad $18 (add grilled chicken $7). Spaghetti pomodoro $22 (vegan). Grilled snapper, seasonal veg $34. Club sandwich $20. Fries $9. A $6 tray charge applies to every order.",
      },
      {
        kind: "text",
        title: "Breakfast & hours",
        content:
          "Breakfast 6:30–11 AM: Continental basket $19, American (eggs any style, bacon, toast) $24, Açaí bowl $16, Avocado toast $17. Full menu available 11 AM–11 PM; an overnight menu (sandwiches, snacks) runs 11 PM–6:30 AM.",
      },
      {
        kind: "qa",
        title: "Dietary options",
        question: "Do you have vegan or gluten-free options?",
        content:
          "Yes — the spaghetti pomodoro and açaí bowl are vegan; gluten-free bread is available for any sandwich (+$3). Please flag allergies in your order and the kitchen will accommodate.",
      },
    ],
    conversations: [
      {
        guest: "David Okafor",
        room: "207",
        topic: "Dinner order",
        sentiment: "positive",
        outcome: "order_placed",
        ageH: 2,
        turns: [
          ["guest", "Can I get two cove burgers and fries to room 207?"],
          [
            "bot",
            "Absolutely! That's 2× Cove Burger with fries ($26 each) = $52, plus the $6 tray charge → $58 total to room 207. Can I get your name for the order?",
          ],
          ["guest", "David Okafor"],
          [
            "bot",
            "Thanks David! Order confirmed: 2× Cove Burger, room 207, $58 total. The kitchen is on it — about 35 minutes. Enjoy! 🍔",
            1,
          ],
        ],
      },
      {
        guest: "Lucia Romano",
        room: "Villa 1",
        topic: "Dietary options",
        sentiment: "positive",
        outcome: "order_placed",
        ageH: 14,
        turns: [
          ["guest", "Any vegan dinner options?"],
          [
            "bot",
            "Yes! The spaghetti pomodoro ($22) is fully vegan and a guest favourite. Would you like to order one?",
          ],
          ["guest", "Perfect, one for Villa 1 please."],
          [
            "bot",
            "Done — 1× Spaghetti Pomodoro (vegan) + $6 tray = $28 to Villa 1. About 30 minutes. Buon appetito! 🌱",
          ],
        ],
      },
      {
        guest: "Room 330",
        room: "330",
        topic: "Hours",
        sentiment: "neutral",
        outcome: "resolved",
        ageH: 40,
        turns: [
          ["guest", "is room service still open its 1am"],
          [
            "bot",
            "We are! The overnight menu (sandwiches and snacks) runs 11 PM–6:30 AM. Want me to take an order?",
          ],
          ["guest", "no just checking thanks"],
        ],
      },
    ],
  },
  {
    name: "Terrace Reservations",
    template: "restaurant",
    status: "published",
    config: {
      version: 1,
      instructions:
        "You take dinner reservations for The Terrace, Solana Cove's Mediterranean sea-view restaurant. Answer questions about hours, menu highlights, and dress code from the knowledge base, then book a table using your booking tool. Confirm party size and time. Keep it warm and brief.",
      modelTier: "standard",
      greeting: "Ciao! 🌅 I can book you a sea-view table at The Terrace.",
      suggestedQuestions: [
        "Book a table for 2 tonight",
        "What are your hours?",
        "Is there a dress code?",
      ],
      appearance: {
        displayName: "The Terrace",
        avatarEmoji: "🍷",
        theme: "warm",
        brandColor: "#c2410c",
      },
      guardrails: {
        onlyFromSources: false,
        fallbackMessage: "Let me get our events team to help with that.",
        handoffMessage: "Connecting you with our team now.",
      },
      actions: [
        { type: "answer_from_knowledge", enabled: true },
        {
          type: "book_service",
          enabled: true,
          whenToUse: "When the guest wants a table — confirm party size and time.",
          config: { serviceIds: [svc("terrace")].filter(Boolean), autoConfirm: true },
        },
        {
          type: "collect_guest_info",
          enabled: true,
          whenToUse: "Get the guest's name for the reservation.",
          config: { name: true, email: false, phone: true, room: false },
        },
      ],
    },
    knowledge: [
      {
        kind: "text",
        title: "Hours & service",
        content:
          "The Terrace serves lunch 12:00–2:30 PM and dinner 5:30–9:30 PM (last seating) daily. The sea-view terrace is first-come for walk-ins; reservations guarantee a table. Last sunset tables go fast in high season.",
      },
      {
        kind: "text",
        title: "Menu highlights & dress code",
        content:
          "Mediterranean coastal: wood-grilled catch of the day, house-made pasta, mezze sharing boards, and a 200-label wine list. Smart-casual dress; no swimwear or bare feet after 5 PM. Children's menu available. Vegetarian and gluten-free dishes are marked.",
      },
      {
        kind: "qa",
        title: "Large groups",
        question: "Can you accommodate large groups or private dining?",
        content:
          "Tables up to 8 book online; for 9+ or private dining on the wine terrace, we'll connect you with our events team. A set menu applies to groups of 12 or more.",
      },
    ],
    conversations: [
      {
        guest: "Sofia Marin",
        room: null,
        topic: "Reservation",
        sentiment: "positive",
        outcome: "order_placed",
        ageH: 5,
        turns: [
          ["guest", "Table for 2 tonight around sunset?"],
          [
            "bot",
            "Lovely — sunset is around 7 PM. I have a sea-view two-top at 7:00 PM tonight. Shall I book it? May I have your name?",
          ],
          ["guest", "Sofia Marin, yes please book it."],
          [
            "bot",
            "Booked! Sofia, party of 2, tonight at 7:00 PM at The Terrace. You'll get a confirmation text. We can't wait to host you! 🌅",
            1,
          ],
        ],
      },
      {
        guest: "James O'Neill",
        room: null,
        topic: "Dress code",
        sentiment: "neutral",
        outcome: "resolved",
        ageH: 20,
        turns: [
          ["guest", "Is there a dress code for dinner?"],
          [
            "bot",
            "Smart-casual for dinner — no swimwear or bare feet after 5 PM. Otherwise relaxed and comfortable. Would you like me to book a table?",
          ],
          ["guest", "Maybe later, thanks."],
        ],
      },
      {
        guest: "Group inquiry",
        room: null,
        topic: "Large groups",
        sentiment: "neutral",
        outcome: "escalated",
        ageH: 33,
        turns: [
          ["guest", "We're a party of 14 for a birthday — can you fit us?"],
          [
            "bot",
            "For 12 or more we set up private dining on the wine terrace with a set menu — let me connect you with our events team to plan it properly.",
          ],
          ["guest", "Great, thank you."],
        ],
      },
    ],
  },
  {
    // Draft — shows in the "Drafts" filter, demonstrates unpublished state.
    name: "Spa Booking Assistant",
    template: "custom",
    status: "draft",
    config: {
      version: 1,
      instructions:
        "Help guests browse and book Serenity Spa treatments. (Draft — knowledge and booking flow still being set up by the spa team.)",
      modelTier: "standard",
      greeting: "Hi! I can help you find the perfect spa treatment. 💆",
      suggestedQuestions: ["What treatments do you offer?"],
      appearance: { displayName: "Serenity Spa", avatarEmoji: "💆", theme: "warm" },
      guardrails: {
        onlyFromSources: true,
        fallbackMessage: "Let me get a spa team member to help.",
        handoffMessage: "Connecting you with the spa team.",
      },
      actions: [{ type: "answer_from_knowledge", enabled: true }],
    },
    knowledge: [
      {
        kind: "text",
        title: "Treatment menu (draft)",
        content:
          "Signature treatments: 60-min Deep Tissue $160, 90-min Hot Stone $210, Couples Massage (60 min) $300, Coastal Glow Facial $140. Hydrotherapy circuit included with any 60-min+ treatment.",
      },
    ],
    conversations: [],
  },
];

// ── Wipe prior demo bots (cascades knowledge/conversations/messages/usage) ──

const names = BOTS.map((b) => b.name);
await supabase
  .from("chatbots")
  .delete()
  .eq("property_id", PROPERTY_ID)
  .in("name", names);

// ── Insert ──────────────────────────────────────────────────────────────────

let convoTotal = 0;
let msgTotal = 0;

for (const def of BOTS) {
  const lastTrained = def.knowledge.length > 0 ? hoursAgo(72) : null;
  const { data: bot, error: botErr } = await supabase
    .from("chatbots")
    .insert({
      property_id: PROPERTY_ID,
      name: def.name,
      template: def.template,
      config: def.config,
      status: def.status,
      created_by: creator,
      last_trained_at: lastTrained,
    })
    .select("id, public_slug")
    .single();
  if (botErr) {
    console.error(`✗ bot ${def.name}: ${botErr.message}`);
    process.exit(1);
  }

  // Knowledge sources + one chunk each (FTS retrieval unit).
  for (const k of def.knowledge) {
    const body = k.kind === "qa" ? `Q: ${k.question}\nA: ${k.content}` : k.content;
    const { data: source, error: srcErr } = await supabase
      .from("chatbot_knowledge_sources")
      .insert({
        chatbot_id: bot.id,
        property_id: PROPERTY_ID,
        kind: k.kind,
        title: k.title,
        question: k.question ?? null,
        content: k.content,
        status: "trained",
        char_count: body.length,
        last_trained_at: lastTrained,
      })
      .select("id")
      .single();
    if (srcErr) {
      console.error(`✗ source ${k.title}: ${srcErr.message}`);
      process.exit(1);
    }
    const { error: chunkErr } = await supabase
      .from("chatbot_knowledge_chunks")
      .insert({
        source_id: source.id,
        chatbot_id: bot.id,
        property_id: PROPERTY_ID,
        content: body,
      });
    if (chunkErr) {
      console.error(`✗ chunk ${k.title}: ${chunkErr.message}`);
      process.exit(1);
    }
  }

  // Conversations + messages.
  const usageByDay = new Map();
  for (const conv of def.conversations) {
    const lastAt = hoursAgo(conv.ageH);
    const { data: convo, error: convErr } = await supabase
      .from("chatbot_conversations")
      .insert({
        chatbot_id: bot.id,
        property_id: PROPERTY_ID,
        session_token: randomBytes(16).toString("hex"),
        channel: "web",
        guest_name: conv.guest,
        room_number: conv.room,
        status: conv.outcome === "escalated" ? "human" : "closed",
        outcome: conv.outcome,
        topic: conv.topic,
        sentiment: conv.sentiment,
        message_count: conv.turns.length,
        last_message_at: lastAt,
        created_at: hoursAgo(conv.ageH + 1),
      })
      .select("id")
      .single();
    if (convErr) {
      console.error(`✗ conversation ${conv.guest}: ${convErr.message}`);
      process.exit(1);
    }
    convoTotal++;

    const rows = conv.turns.map(([role, content, feedback], i) => ({
      id: randomUUID(),
      conversation_id: convo.id,
      property_id: PROPERTY_ID,
      role,
      content,
      feedback: feedback ?? null,
      tokens: role === "bot" ? 40 + (hash(content) % 80) : null,
      created_at: new Date(
        Date.now() - conv.ageH * 3600_000 + i * 45_000,
      ).toISOString(),
    }));
    const { error: msgErr } = await supabase
      .from("chatbot_messages")
      .insert(rows);
    if (msgErr) {
      console.error(`✗ messages ${conv.guest}: ${msgErr.message}`);
      process.exit(1);
    }
    msgTotal += rows.length;

    // Tally bot replies per day for usage_daily.
    const day = dayStr(Math.floor(conv.ageH / 24));
    const botReplies = conv.turns.filter((t) => t[0] === "bot").length;
    usageByDay.set(day, (usageByDay.get(day) ?? 0) + botReplies);
  }

  // Backfill 14 days of usage volume so the analytics chart isn't a single
  // spike — real conversations above, plausible ambient traffic elsewhere.
  for (let d = 0; d < 14; d++) {
    const day = dayStr(d);
    const fromConvos = usageByDay.get(day) ?? 0;
    const ambient =
      def.status === "published" ? 3 + (hash(bot.id + day) % 14) : 0;
    const messages = fromConvos + ambient;
    if (messages === 0) continue;
    const { error } = await supabase.from("chatbot_usage_daily").upsert(
      {
        chatbot_id: bot.id,
        property_id: PROPERTY_ID,
        day,
        messages,
        tokens: messages * 90,
      },
      { onConflict: "chatbot_id,day" },
    );
    if (error) {
      console.error(`✗ usage ${day}: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(
    `✅ ${def.name} (${def.status}) — ${def.knowledge.length} sources, ${def.conversations.length} conversations`,
  );
}

console.log(
  `\nDone. ${BOTS.length} bots, ${convoTotal} conversations, ${msgTotal} messages.`,
);
console.log("Look at: Chatbots rail → a published bot → Knowledge / Conversations / Analytics tabs.");
